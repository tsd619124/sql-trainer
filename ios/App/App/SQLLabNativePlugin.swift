import Capacitor
import Foundation
import Security
import UIKit
import UserNotifications

@objc(SQLLabNativePlugin)
public final class SQLLabNativePlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate {
    public let identifier = "SQLLabNativePlugin"
    public let jsName = "SQLLabNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadStore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveStore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notificationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReminderPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise)
    ]

    private let storageQueue = DispatchQueue(label: "com.fengguanjia.sqllab.storage")
    private let allowedKeys = Set([
        "sqltrain_state", "sqltrain_session", "sqltrain_device", "sqltrain_mode",
        "sqltrain_font", "sqltrain_remind", "sqltrain_snap", "sqltrain_sync",
        "sqltrain_state_before_import", "sqltrain_session_before_import"
    ])
    private let credentialService = "com.fengguanjia.sqllab.sync"
    private let reminderPrefix = "sql-lab-daily-"
    private var observers: [NSObjectProtocol] = []
    private var reminderRevision = 0

    public override func load() {
        UNUserNotificationCenter.current().delegate = self
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("appStateChange", data: ["isActive": false])
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("appStateChange", data: ["isActive": true])
        })
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    private func storageURL() throws -> URL {
        let manager = FileManager.default
        let base = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = base.appendingPathComponent("SQLLab", isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("learning.json")
    }

    private func readValues() throws -> [String: String] {
        let url = try storageURL()
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode([String: String].self, from: data)
    }

    private func keychainQuery() -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: credentialService,
                kSecAttrAccount as String: "sync-config"]
    }

    private func readCredential() throws -> String? {
        var query = keychainQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "SQLLabStore", code: Int(status))
        }
        return value
    }

    private func saveCredential(_ value: String?) throws {
        let query = keychainQuery()
        guard let value = value else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw NSError(domain: "SQLLabStore", code: Int(status))
            }
            return
        }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8),
                                      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insertion = query
            for (key, item) in attributes { insertion[key] = item }
            status = SecItemAdd(insertion as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NSError(domain: "SQLLabStore", code: Int(status)) }
    }

    @objc public func loadStore(_ call: CAPPluginCall) {
        storageQueue.async {
            do {
                var values = try self.readValues().filter { self.allowedKeys.contains($0.key) }
                values.removeValue(forKey: "sqltrain_sync")
                if let credential = try self.readCredential() { values["sqltrain_sync"] = credential }
                let initialized = FileManager.default.fileExists(atPath: try self.storageURL().path)
                call.resolve(["values": values, "initialized": initialized])
            } catch {
                call.reject("无法读取本机学习数据，原文件已保留", "STORE_READ_FAILED")
            }
        }
    }

    @objc public func saveStore(_ call: CAPPluginCall) {
        guard let changes = call.getObject("values"), changes.count <= allowedKeys.count,
              changes.allSatisfy({ allowedKeys.contains($0.key) && ($0.value is String || $0.value is NSNull) }),
              changes.values.allSatisfy({ (($0 as? String)?.utf8.count ?? 0) <= 10_000_000 }) else {
            call.reject("学习数据格式无效", "INVALID_STORE")
            return
        }
        storageQueue.async {
            do {
                var values = try self.readValues().filter { self.allowedKeys.contains($0.key) }
                for (key, value) in changes where key != "sqltrain_sync" {
                    if let text = value as? String { values[key] = text }
                    else { values.removeValue(forKey: key) }
                }
                values.removeValue(forKey: "sqltrain_sync")
                let data = try JSONEncoder().encode(values)
                if let credential = changes["sqltrain_sync"] { try self.saveCredential(credential as? String) }
                try data.write(to: self.storageURL(), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                call.resolve()
            } catch {
                call.reject("本机学习数据保存失败，请导出备份后重试", "STORE_WRITE_FAILED")
            }
        }
    }

    private func permissionName(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "default"
        }
    }

    @objc public func notificationStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["permission": self.permissionName(settings.authorizationStatus)])
        }
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                       withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                       withCompletionHandler completionHandler: @escaping () -> Void) {
        notifyListeners("openTraining", data: [:], retainUntilConsumed: true)
        completionHandler()
    }

    @objc public func requestReminderPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, error in
            if error != nil { call.reject("无法请求通知权限", "NOTIFICATION_PERMISSION_FAILED"); return }
            self.notificationStatus(call)
        }
    }

    @objc public func setReminder(_ call: CAPPluginCall) {
        guard let time = call.getString("time"),
              time.range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) != nil else {
            call.reject("提醒时间无效", "INVALID_REMINDER_TIME")
            return
        }
        let enabled = call.getBool("enabled") ?? false
        let completedDays = Set(call.getArray("completedDays", String.self) ?? [])
        let components = time.split(separator: ":").compactMap { Int($0) }
        DispatchQueue.main.async {
            self.reminderRevision += 1
            let revision = self.reminderRevision
            let center = UNUserNotificationCenter.current()
            center.getPendingNotificationRequests { requests in
                DispatchQueue.main.async {
                    guard revision == self.reminderRevision else { call.resolve(["superseded": true]); return }
                    center.removePendingNotificationRequests(withIdentifiers: requests.map(\.identifier).filter { $0.hasPrefix(self.reminderPrefix) })
                    guard enabled else { call.resolve(["scheduled": 0]); return }
                    center.getNotificationSettings { settings in
                        DispatchQueue.main.async {
                            guard revision == self.reminderRevision else { call.resolve(["superseded": true]); return }
                            guard self.permissionName(settings.authorizationStatus) == "granted" else {
                                call.reject("请在 iOS 设置中允许 SQL Lab 通知", "NOTIFICATION_DENIED")
                                return
                            }
                            let calendar = Calendar.current
                            let now = Date()
                            let formatter = DateFormatter()
                            formatter.locale = Locale(identifier: "en_US_POSIX")
                            formatter.calendar = calendar
                            formatter.timeZone = calendar.timeZone
                            formatter.dateFormat = "yyyy-MM-dd"
                            let group = DispatchGroup()
                            let lock = NSLock()
                            var failed = false
                            var scheduled = 0
                            for offset in 0..<30 {
                                guard let day = calendar.date(byAdding: .day, value: offset, to: now) else { continue }
                                let key = formatter.string(from: day)
                                guard !completedDays.contains(key),
                                      let fireDate = calendar.date(bySettingHour: components[0], minute: components[1], second: 0, of: day),
                                      fireDate > now else { continue }
                                let content = UNMutableNotificationContent()
                                content.title = "SQL 训练时间到"
                                content.body = "今天练一道 SQL，或复习一节微课，继续你的八周学习。"
                                content.sound = .default
                                let date = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
                                let request = UNNotificationRequest(identifier: self.reminderPrefix + key, content: content,
                                                                    trigger: UNCalendarNotificationTrigger(dateMatching: date, repeats: false))
                                group.enter()
                                scheduled += 1
                                center.add(request) { error in
                                    if error != nil { lock.lock(); failed = true; lock.unlock() }
                                    group.leave()
                                }
                            }
                            group.notify(queue: .main) {
                                if failed { call.reject("部分系统提醒未能保存，请重新设置", "REMINDER_SCHEDULE_FAILED") }
                                else { call.resolve(["scheduled": scheduled]) }
                            }
                        }
                    }
                }
            }
        }
    }

    @objc public func shareBackup(_ call: CAPPluginCall) {
        guard let content = call.getString("content"), content.utf8.count <= 10_000_000,
              let filename = call.getString("filename"), filename.hasSuffix(".json"),
              !filename.contains("/"), !filename.contains("\\"), !filename.contains("..") else {
            call.reject("备份文件格式无效", "INVALID_BACKUP")
            return
        }
        DispatchQueue.main.async {
            do {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let url = directory.appendingPathComponent(filename)
                try Data(content.utf8).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                guard let controller = self.bridge?.viewController else { throw NSError(domain: "SQLLabShare", code: 1) }
                let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                if let popover = share.popoverPresentationController {
                    popover.sourceView = controller.view
                    popover.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
                    popover.permittedArrowDirections = []
                }
                share.completionWithItemsHandler = { _, completed, _, error in
                    try? FileManager.default.removeItem(at: directory)
                    if error != nil { call.reject("系统分享失败", "SHARE_FAILED") }
                    else if completed { call.resolve() }
                    else { call.reject("已取消分享，原进度未改变", "SHARE_CANCELLED") }
                }
                controller.present(share, animated: true)
            } catch {
                call.reject("无法生成备份文件", "BACKUP_EXPORT_FAILED")
            }
        }
    }

    @objc public func haptic(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            call.resolve()
        }
    }
}
