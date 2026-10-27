import Foundation
import CryptoKit
import CommonCrypto
import Security

/// 与现有 Web AES-GCM / PBKDF2 协议一致；密码永不进入学习备份。
public enum SyncCipher {
    private static func key(_ code: String) throws -> SymmetricKey {
        guard code.utf8.count >= 8 else { throw LabError.message("同步码至少需要 8 个字符。") }
        let salt = Array("sqltrain-sync-v1".utf8), password = Array(code.utf8); var bytes = [UInt8](repeating: 0, count: 32)
        let status = password.withUnsafeBytes { pass in salt.withUnsafeBufferPointer { salt in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pass.baseAddress!.assumingMemoryBound(to: Int8.self), password.count, salt.baseAddress!, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 100000, &bytes, bytes.count)
        } }
        guard status == kCCSuccess else { throw LabError.message("无法生成同步密钥。") }; return SymmetricKey(data: bytes)
    }
    public static func encrypt(_ value: JSONValue, code: String) throws -> String {
        let box = try AES.GCM.seal(value.data(), using: key(code))
        return JSONValue.object(["v": .number(1), "enc": .string("AES-GCM"), "iv": .string(Data(box.nonce).base64EncodedString()), "data": .string((box.ciphertext + box.tag).base64EncodedString())]).canonical
    }
    public static func decrypt(_ text: String, code: String) throws -> JSONValue {
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
        guard value["enc"].string == "AES-GCM" else { return value }
        guard let iv = Data(base64Encoded: value["iv"].string ?? ""), iv.count == 12, let body = Data(base64Encoded: value["data"].string ?? ""), body.count >= 16 else { throw LabError.message("云端加密数据无效。") }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: body.dropLast(16), tag: body.suffix(16))
        let data = try AES.GCM.open(box, using: key(code)); return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}

public enum SyncCredentials {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.fengguanjia.sqllab.sync", kSecAttrAccount as String: "sync-config"] }
    public static func load() throws -> JSONValue {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return .object([:]) }
        guard status == errSecSuccess, let data = result as? Data else { throw LabError.message("无法读取钥匙串中的同步配置。") }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
    public static func save(_ value: JSONValue) throws {
        let attributes: [String: Any] = [kSecValueData as String: try value.data(), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound { var q = query; q.merge(attributes) { _, v in v }; status = SecItemAdd(q as CFDictionary, nil) }
        guard status == errSecSuccess else { throw LabError.message("同步配置未能保存到钥匙串。") }
    }
}

private final class NoSyncRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

public actor CloudSync {
    private let session: URLSession
    public init(session: URLSession? = nil) { self.session = session ?? URLSession(configuration: .ephemeral, delegate: NoSyncRedirects(), delegateQueue: nil) }
    private func request(_ url: URL, config: JSONValue, method: String = "GET", body: JSONValue? = nil) async throws -> JSONValue {
        guard url.scheme == "https", url.user == nil, url.password == nil else { throw LabError.message("同步服务必须使用 HTTPS。") }
        var req = URLRequest(url: url); req.timeoutInterval = 30; req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if config["provider"].string == "lc" {
            req.setValue(config["appId"].string ?? "", forHTTPHeaderField: "X-LC-Id"); req.setValue(config["appKey"].string ?? "", forHTTPHeaderField: "X-LC-Key")
        } else {
            req.setValue("Bearer " + (config["token"].string ?? ""), forHTTPHeaderField: "Authorization")
            req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        }
        if let body { req.httpBody = try body.data() }
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: req) }
        catch let error as URLError {
            if [.secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate].contains(error.code) { throw LabError.message("安全连接失败，请检查系统日期、网络与 VPN 后重试。") }
            throw LabError.message("无法连接同步服务，请检查网络后重试。")
        }
        guard let response = response as? HTTPURLResponse else { throw LabError.message("同步服务响应无效，请稍后重试。") }
        switch response.statusCode {
        case 200..<300: break
        case 401, 403: throw LabError.message("认证失败，请检查令牌或 App Key 的权限后重试。")
        case 404: throw LabError.message("未找到云端记录，请核对 Gist ID 或服务地址，避免重复新建。")
        case 429: throw LabError.message("同步请求过于频繁，请稍后重试。")
        default: throw LabError.message("同步服务暂不可用（\(response.statusCode)），请稍后重试。")
        }
        guard data.count <= 10000000 else { throw LabError.message("云端数据超过 10 MB，已停止同步。") }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
    private func base(_ config: JSONValue) throws -> URL {
        if config["provider"].string == "lc" {
            guard let text = config["base"].string, let url = URL(string: text), url.scheme == "https", url.host != nil, !(config["appId"].string ?? "").isEmpty, !(config["appKey"].string ?? "").isEmpty else { throw LabError.message("LeanCloud 配置不完整。") }
            return url.appendingPathComponent("1.1/classes/Progress")
        }
        guard !(config["token"].string ?? "").isEmpty else { throw LabError.message("请配置 GitHub Gist 令牌。") }
        return URL(string: "https://api.github.com/gists")!
    }
    public func pull(config: JSONValue) async throws -> (progress: JSONValue?, remoteID: String?) {
        let base = try base(config), code = config["code"].string ?? ""
        guard code.count >= 8 else { throw LabError.message("请输入原有同步码，至少 8 个字符。") }
        var remote: JSONValue; var id: String?
        if config["provider"].string == "lc" {
            var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "where", value: JSONValue.object(["code": .string(code)]).canonical), URLQueryItem(name: "order", value: "-updatedAt"), URLQueryItem(name: "limit", value: "2")]
            let response = try await request(components.url!, config: config)
            guard let rows = response["results"].array else { throw LabError.message("云端记录列表无效，已停止同步。") }
            guard let first = rows.first else { return (nil, nil) }; remote = first; id = first["objectId"].string
        } else {
            guard let gist = config["gistId"].string, !gist.isEmpty else { return (nil, nil) }
            guard gist.range(of: "^[A-Za-z0-9]+$", options: .regularExpression) != nil else { throw LabError.message("Gist ID 格式无效。") }
            let response = try await request(base.appendingPathComponent(gist), config: config)
            let file = response["files"]["sync.json"]
            guard file["truncated"].bool != true else { throw LabError.message("云端文件被截断，已停止同步。") }
            remote = .object(["payload": file["content"]]); id = gist
        }
        guard let payload = remote["payload"].string, !payload.isEmpty, id != nil else { throw LabError.message("云端进度缺失，已停止同步，未覆盖云端。") }
        return (try SyncCipher.decrypt(payload, code: code), id)
    }
    public func push(_ progress: JSONValue, config: JSONValue, remoteID: String?) async throws -> String {
        let base = try base(config)
        let payload = try SyncCipher.encrypt(progress, code: config["code"].string ?? "")
        if config["provider"].string == "lc" {
            var body: JSONValue = .object(["payload": .string(payload)])
            if remoteID == nil { body["code"] = config["code"] }
            let response = try await request(remoteID.map { base.appendingPathComponent($0) } ?? base, config: config, method: remoteID == nil ? "POST" : "PUT", body: body)
            guard let id = remoteID ?? response["objectId"].string else { throw LabError.message("上传已响应，但缺少远端 ID，请核对云端后再重试。") }; return id
        }
        var body: JSONValue = .object(["files": .object(["sync.json": .object(["content": .string(payload)])])])
        if remoteID == nil { body["public"] = .bool(false); body["description"] = .string("SQL训练系统同步数据（端到端加密）") }
        let response = try await request(remoteID.map { base.appendingPathComponent($0) } ?? base, config: config, method: remoteID == nil ? "POST" : "PATCH", body: body)
        guard let id = remoteID ?? response["id"].string else { throw LabError.message("上传已响应，但缺少 Gist ID，请核对云端后再重试。") }; return id
    }
}
