import XCTest
@testable import SQLLabCore
@testable import SQLLabUI

private actor ProductCloudBackend {
    private var payload: String
    private var rejectReads = false
    private var writes = 0
    private var onPush: (@Sendable () async throws -> Void)?
    init() throws { payload = try SyncCipher.encrypt(Progress.empty, code: "product-test-code") }
    func failReads() { rejectReads = true }
    func writeCount() -> Int { writes }
    func duringPush(_ action: @escaping @Sendable () async throws -> Void) { onPush = action }
    func respond(_ request: URLRequest) async throws -> (Int, JSONValue) {
        if request.httpMethod == "GET" {
            if rejectReads { return (401, .object([:])) }
            return (200, .object(["files": .object(["sync.json": .object(["content": .string(payload)])])]))
        }
        XCTAssertEqual(request.httpMethod, "PATCH")
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); guard count > 0 else { break }; data.append(contentsOf: buffer.prefix(count)) }
        }
        let body = try JSONDecoder().decode(JSONValue.self, from: data)
        payload = try XCTUnwrap(body["files"]["sync.json"]["content"].string); writes += 1
        if let action = onPush { onPush = nil; try await action() }
        return (200, .object(["id": .string("abc123")]))
    }
}

private final class ProductCloudProtocol: URLProtocol, @unchecked Sendable {
    static var backend: ProductCloudBackend?
    private var operation: Task<Void, Never>?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        operation = Task {
            do {
                let backend = try XCTUnwrap(Self.backend), (status, value) = try await backend.respond(request)
                guard !Task.isCancelled else { return }
                let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: try value.data()); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() { operation?.cancel() }
}

@MainActor final class SyncProductTests: XCTestCase {
    private var config: JSONValue { .object(["provider": .string("gist"), "gistId": .string("abc123"), "token": .string("product-test-token"), "code": .string("product-test-code")]) }
    private func service(_ backend: ProductCloudBackend) -> CloudSync {
        ProductCloudProtocol.backend = backend
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ProductCloudProtocol.self]
        return CloudSync(session: URLSession(configuration: configuration))
    }
    func testTwoClientsRoundTripPreservesEvidenceHistoryAndDeletions() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try LabModel(directory: root.appendingPathComponent("first")), second = try LabModel(directory: root.appendingPathComponent("second"))
        let backend = try ProductCloudBackend(), cloud = service(backend)
        first.change { $0["notes"]["q1"] = .string("同步笔记") }
        try first.record("q1", sql: "SELECT 1", passed: true, used: false)
        _ = try await first.synchronize(config: config, service: cloud, saveConfiguration: { _ in })
        XCTAssertFalse(first.pendingSync)
        try second.record("q7", sql: "SELECT 1", passed: true, used: false)
        _ = try await second.synchronize(config: config, service: cloud, saveConfiguration: { _ in })
        _ = try await first.synchronize(config: config, service: cloud, saveConfiguration: { _ in })
        XCTAssertEqual(first.completed, 2); XCTAssertEqual(first.state["evidence"].object?.count, 2)
        XCTAssertEqual(first.state, second.state)
        first.change { var notes = $0["notes"].object!; notes.removeValue(forKey: "q1"); $0["notes"] = .object(notes) }
        _ = try await first.synchronize(config: config, service: cloud, saveConfiguration: { _ in })
        _ = try await second.synchronize(config: config, service: cloud, saveConfiguration: { _ in })
        XCTAssertEqual(second.state["notes"]["q1"], .null)
        XCTAssertEqual(second.state["evidence"], first.state["evidence"])
        XCTAssertFalse(second.pendingSync)
        XCTAssertFalse(second.recoveryPoints.isEmpty)
        let reopened = try LabModel(directory: root.appendingPathComponent("second")); XCTAssertFalse(reopened.pendingSync)
    }
    func testUploadAcknowledgesOnlyItsSnapshotAndFailuresRemainActionable() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let model = try LabModel(directory: root), backend = try ProductCloudBackend(), cloud = service(backend)
        try model.record("q1", sql: "SELECT 1", passed: true, used: false)
        await backend.duringPush { try await MainActor.run { try model.record("q7", sql: "SELECT 1", passed: true, used: false) } }
        _ = try await model.synchronize(config: config, service: cloud, saveConfiguration: { _ in })
        XCTAssertTrue(model.pendingSync); XCTAssertNotNil(model.metadata["lastSyncAt"].number)
        XCTAssertTrue(try LabModel(directory: root).pendingSync)
        _ = try await model.synchronize(config: config, service: cloud, saveConfiguration: { _ in }); XCTAssertFalse(model.pendingSync)
        let before = model.state, writes = await backend.writeCount()
        await backend.failReads()
        do { _ = try await model.synchronize(config: config, service: cloud, saveConfiguration: { _ in }); XCTFail("应停止上传") } catch { XCTAssertTrue(error.localizedDescription.contains("认证失败")) }
        let afterWrites = await backend.writeCount(); XCTAssertEqual(afterWrites, writes)
        XCTAssertEqual(model.state, before); XCTAssertTrue(model.metadata["syncError"].string?.contains("认证失败") == true)
        XCTAssertEqual(try LabModel(directory: root).metadata, model.metadata)
    }
}
