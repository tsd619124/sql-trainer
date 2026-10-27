import SwiftUI
import SQLLabCore

struct SyncView: View {
    let model: LabModel
    @State private var provider = "gist"
    @State private var gistID = ""
    @State private var base = ""
    @State private var appID = ""
    @State private var token = ""
    @State private var appKey = ""
    @State private var code = ""
    @State private var status = "已有配置将安全读取；留空的密码字段保留原值。"
    var body: some View {
        Form {
            Section("同步服务") {
                Picker("服务", selection: $provider) { Text("GitHub Gist").tag("gist"); Text("LeanCloud").tag("lc") }
                if provider == "gist" { TextField("Gist ID（新建可留空）", text: $gistID); SecureField("Gist 令牌", text: $token) }
                else { TextField("HTTPS API 域名", text: $base); TextField("App ID", text: $appID); SecureField("App Key", text: $appKey) }
                SecureField("与其他设备相同的同步码", text: $code)
            }.autocorrectionDisabled()
            Section {
                Text("进度使用 AES-GCM 加密，配置存入钥匙串。每次同步先读取并合并云端，再上传；云端读取或解密失败时停止上传。").font(.caption)
                Text("另一台设备也需先更新应用，才能完整保留新的学习路径、周测历史与能力记录。").font(.caption).foregroundStyle(.secondary)
                Button(model.syncing ? "正在同步…" : "保存配置并同步") { Task { await sync() } }.disabled(model.syncing || model.busy)
                Text(status).font(.caption).textSelection(.enabled)
            }
        }.navigationTitle("云同步")
        .task {
            do {
                let c = try SyncCredentials.load()
                provider = c["provider"].string ?? "gist"; gistID = c["gistId"].string ?? ""; base = c["base"].string ?? ""; appID = c["appId"].string ?? ""
            } catch { status = error.localizedDescription }
        }
    }
    func sync() async {
        do {
            var config = try SyncCredentials.load()
            config["provider"] = .string(provider); config["gistId"] = .string(gistID.trimmingCharacters(in: .whitespacesAndNewlines)); config["base"] = .string(base.trimmingCharacters(in: .whitespacesAndNewlines)); config["appId"] = .string(appID)
            if !token.isEmpty { config["token"] = .string(token) }; if !appKey.isEmpty { config["appKey"] = .string(appKey) }; if !code.isEmpty { config["code"] = .string(code) }
            config["enc"] = .bool(true); try SyncCredentials.save(config)
            token = ""; appKey = ""; code = ""
            config = try await model.synchronize(config: config)
            if provider == "gist" { gistID = config["gistId"].string ?? "" }
            status = model.pendingSync ? "本轮同步完成；同步期间又有本地修改，请再次同步。" : "已同步，云端与本机进度已合并。"
        } catch { status = "同步未完成：" + error.localizedDescription + " 本机进度已保留。" }
    }
}
