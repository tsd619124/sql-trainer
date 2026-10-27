import XCTest
@testable import SQLLabCore

private final class MockCloud: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, JSONValue))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (code, value) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try value.data()); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
final class CloudTests: XCTestCase {
    private func service() -> CloudSync {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MockCloud.self]
        return CloudSync(session: URLSession(configuration: config))
    }
    func testGistEncryptedPullAndPush() async throws {
        let state = try Progress.normalize(Progress.empty, catalog: Catalog.load())
        let config: JSONValue = .object(["provider": .string("gist"), "token": .string("test-only-token"), "code": .string("test-code-123"), "gistId": .string("abc123")])
        let payload = try SyncCipher.encrypt(state, code: "test-code-123")
        MockCloud.handler = { request in
            XCTAssertEqual(request.url?.host, "api.github.com")
            if request.httpMethod == "GET" { return (200, .object(["files": .object(["sync.json": .object(["content": .string(payload)])])])) }
            XCTAssertEqual(request.httpMethod, "PATCH"); return (200, .object(["id": .string("abc123")]))
        }
        let service = service(), remote = try await service.pull(config: config)
        XCTAssertEqual(remote.progress, state); XCTAssertEqual(remote.remoteID, "abc123")
        let id = try await service.push(state, config: config, remoteID: remote.remoteID); XCTAssertEqual(id, "abc123")
    }
    func testBadRemoteNeverLooksLikeEmptyRemote() async throws {
        let config: JSONValue = .object(["provider": .string("gist"), "token": .string("fake-token"), "code": .string("test-code-123"), "gistId": .string("abc123")])
        for status in [200, 401, 404, 500] {
            MockCloud.handler = { request in XCTAssertEqual(request.httpMethod, "GET"); return (status, .object([:])) }
            do { _ = try await service().pull(config: config); XCTFail("损坏或失效的远端必须报错") } catch { }
        }
    }
    func testLeanCloudReadAndUpdate() async throws {
        let state = try Progress.normalize(Progress.empty, catalog: Catalog.load())
        let config: JSONValue = .object(["provider": .string("lc"), "base": .string("https://example.invalid"), "appId": .string("fake-id"), "appKey": .string("fake-key"), "code": .string("test-code-123")])
        MockCloud.handler = { request in
            if request.httpMethod == "GET" { return (200, .object(["results": .array([.object(["objectId": .string("record1"), "payload": .string(state.canonical)])])])) }
            XCTAssertEqual(request.httpMethod, "PUT"); XCTAssertTrue(request.url!.path.hasSuffix("/record1")); return (200, .object(["updatedAt": .string("now")]))
        }
        let service = service(), remote = try await service.pull(config: config)
        XCTAssertEqual(remote.progress, state)
        let id = try await service.push(state, config: config, remoteID: remote.remoteID); XCTAssertEqual(id, "record1")
    }
}
