import SwiftUI
import SQLLabCore
import UniformTypeIdentifiers
import UserNotifications

struct BackupControls: View {
    let model: LabModel
    @State private var document = BackupDocument(data: Data())
    @State private var exporting = false
    @State private var importing = false
    @State private var pending: Data?
    @State private var chooseImport = false
    var body: some View {
        Section("备份与迁移") {
            Text("可导入旧版 JSON 或进度码。学习路径、周测历史与作答证据进入备份；草稿与恢复点保存在本机，认证信息留在钥匙串。").font(.caption).foregroundStyle(.secondary)
            Button("导出学习备份") { do { document = BackupDocument(data: try model.backup()); exporting = true } catch { model.error = error.localizedDescription } }
            Button("导入备份") { importing = true }.disabled(model.syncing || model.busy)
            Button("恢复导入前的进度与草稿") { model.undo() }.disabled(model.syncing || model.busy)
        }
        .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: "SQLLab-\(LocalDay.string()).json") { result in
            switch result { case .success: model.backupExported(document.data); case .failure(let error): model.error = error.localizedDescription }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .plainText]) { result in
            do {
                let url = try result.get(), access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 10_000_000 else { throw LabError.message("备份超过 10 MB。") }
                pending = try Data(contentsOf: url); chooseImport = true
            } catch { model.error = error.localizedDescription }
        }
        .confirmationDialog("导入前将保留当前进度与草稿恢复点。", isPresented: $chooseImport) {
            Button("合并，保留较新的记录") { if let pending { model.importBackup(pending, merge: true) } }
            Button("替换当前进度", role: .destructive) { if let pending { model.importBackup(pending, merge: false) } }
            Button("取消", role: .cancel) { pending = nil }
        }
    }
}

struct DataCenterView: View {
    let model: LabModel
    @State private var restoring: RecoveryPoint?
    @State private var configured = false
    @State private var legacySync: Double?
    var body: some View {
        Form {
            Section("数据状态") {
                LabeledContent("本地保存", value: "每次成功作答后原子保存")
                LabeledContent("最近成功导出", value: timestamp(model.metadata["lastBackupAt"].number))
                if model.metadata["backupFingerprint"].string != nil, model.metadata["backupFingerprint"].string != LabModel.fingerprint(model.state) { Text("导出后又有学习修改，建议重新导出备份。").font(.caption).foregroundStyle(.orange) }
                LabeledContent("最近成功同步", value: timestamp(model.metadata["lastSyncAt"].number ?? legacySync))
                LabeledContent("同步状态", value: model.syncing ? "正在同步" : model.pendingSync ? "待同步" : "当前进度已同步").accessibilityIdentifier("sync-state")
                if model.pendingSync { Text(configured ? "本机有未确认上传的进度。请手动同步；草稿不参与云同步。" : "尚未配置云同步。可先导出本地备份，再按需配置同步。").font(.caption).foregroundStyle(.secondary) }
                if let error = model.metadata["syncError"].string, !error.isEmpty { Text("上次同步未完成：" + error + " 本机进度已保留。").font(.caption).foregroundStyle(.orange) }
                NavigationLink(configured ? "检查配置并重试云同步" : "配置云同步") { SyncView(model: model) }
            }
            BackupControls(model: model)
            Section("本机恢复点") {
                Text("恢复前再保留当前进度与草稿；恢复会生成新的修订，防止下一次同步被旧数据覆盖。").font(.caption).foregroundStyle(.secondary)
                Button("创建当前恢复点") { model.createRecoveryPoint() }.disabled(model.syncing || model.busy).accessibilityIdentifier("create-recovery")
                if model.recoveryPoints.isEmpty { Text("导入、云端合并或手动创建后，将出现可恢复记录。").foregroundStyle(.secondary) }
                ForEach(model.recoveryPoints) { point in
                    Button { restoring = point } label: { VStack(alignment: .leading) { Text(point.label); Text(timestamp(point.createdAt)).font(.caption).foregroundStyle(.secondary) } }.disabled(model.syncing || model.busy).accessibilityIdentifier("restore-" + point.id)
                }
            }
        }.navigationTitle("数据与同步")
        .task {
            do { let config = try SyncCredentials.load(); configured = !(config["code"].string ?? "").isEmpty; legacySync = config["lastSync"].number }
            catch { model.error = "无法读取同步配置，可先使用本地备份。" }
        }
        .confirmationDialog("恢复这个时间点的学习进度与草稿？", isPresented: Binding(get: { restoring != nil }, set: { if !$0 { restoring = nil } })) {
            if let point = restoring { Button("恢复此记录", role: .destructive) { model.restore(point); restoring = nil } }
            Button("取消", role: .cancel) { restoring = nil }
        }
    }
    private func timestamp(_ value: Double?) -> String { value.map { Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened) } ?? "暂无记录" }
}

struct ReminderSettings: View {
    @State private var remindAt = Calendar.current.date(from: DateComponents(hour: 20, minute: 0)) ?? Date()
    @State private var loading = true
    @State private var updating = false
    @State private var status: String?
    @AppStorage("native-reminder-enabled") private var reminder = false
    @AppStorage("native-reminder-hour") private var savedHour = 20
    @AppStorage("native-reminder-minute") private var savedMinute = 0
    @Environment(\.scenePhase) private var scenePhase
    private let requestID = "sql-lab-native-daily"
    var body: some View {
        Section("学习提醒") {
            DatePicker("每天提醒时间", selection: $remindAt, displayedComponents: .hourAndMinute).disabled(loading || updating).accessibilityIdentifier("reminder-time")
            Button(reminder ? "更新提醒时间" : "开启学习提醒") { Task { await schedule() } }.disabled(loading || updating)
            if reminder { Button("关闭提醒") { UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [requestID]); reminder = false; status = "学习提醒已关闭，已保留上次设定时间。" }.disabled(updating) }
            if let status { Text(status).font(.caption).accessibilityIdentifier("reminder-status") }
        }
        .task { await load() }
        .onChange(of: scenePhase) { if scenePhase == .active && !updating { Task { await load() } } }
    }
    private func load() async {
        loading = true; defer { loading = false }
        let center = UNUserNotificationCenter.current(), requests = await center.pendingNotificationRequests()
        if let trigger = requests.first(where: { $0.identifier == requestID })?.trigger as? UNCalendarNotificationTrigger,
           let hour = trigger.dateComponents.hour, let minute = trigger.dateComponents.minute {
            savedHour = hour; savedMinute = minute; reminder = true
        } else { reminder = false }
        let hour = min(23, max(0, savedHour)), minute = min(59, max(0, savedMinute))
        remindAt = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
        let settings = await center.notificationSettings()
        status = settings.authorizationStatus == .denied ? "系统通知权限已关闭，请在系统设置中允许通知后重试。" : reminder ? String(format: "当前已设定每天 %02d:%02d 提醒", hour, minute) : String(format: "提醒未开启，当前保留时间为 %02d:%02d。", hour, minute)
    }
    private func schedule() async {
        updating = true; defer { updating = false }
        do {
            let center = UNUserNotificationCenter.current()
            guard try await center.requestAuthorization(options: [.alert, .sound]) else { status = "通知权限未开启，可在系统设置中调整。"; return }
            let content = UNMutableNotificationContent(); content.title = "今天也练一点 SQL"; content.body = "继续今日学习任务，或独立完成到期复习。"; content.sound = .default
            let parts = Calendar.current.dateComponents([.hour, .minute], from: remindAt)
            try await center.add(UNNotificationRequest(identifier: requestID, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: true)))
            savedHour = parts.hour ?? 20; savedMinute = parts.minute ?? 0; reminder = true
            status = String(format: "已设定每天 %02d:%02d 提醒", savedHour, savedMinute)
        } catch { status = "提醒未更新：" + error.localizedDescription }
    }
}
