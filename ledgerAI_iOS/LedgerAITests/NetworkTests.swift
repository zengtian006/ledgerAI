import XCTest
@testable import LedgerAI

final class APIClientTests: XCTestCase {
    private func client(token: String? = "tok") -> APIClient {
        let api = APIClient(session: StubURLProtocol.session(), baseURL: URL(string: "https://api.test")!)
        api.tokenProvider = { token }
        return api
    }

    func testSendsBearerTokenAndQuery() async throws {
        let api = client()
        StubURLProtocol.handler = { _ in (200, StubURLProtocol.json(["receipts": [], "count": 0, "sum": 0])) }
        let list: ReceiptsResponse = try await api.get("/receipts", query: ["limit": "10", "q": nil, "category": ""])
        XCTAssertEqual(list.count, 0)

        let request = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://api.test/api/receipts?limit=10")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
    }

    func testNoAuthorizationHeaderWithoutToken() async throws {
        let api = client(token: nil)
        StubURLProtocol.handler = { _ in (200, StubURLProtocol.json(["countries": [], "currencies": []])) }
        _ = try await api.countries()
        XCTAssertNil(StubURLProtocol.requests.first?.value(forHTTPHeaderField: "Authorization"))
    }

    func testUnauthorizedNotifiesAndThrows() async {
        let api = client()
        var notified = false
        api.onUnauthorized = { notified = true }
        StubURLProtocol.handler = { _ in (401, StubURLProtocol.json(["error": "Invalid or expired token"])) }
        do {
            _ = try await api.profile()
            XCTFail("expected error")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 401)
            XCTAssertEqual(error.message, "Invalid or expired token")
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertTrue(notified)
    }

    func testValidationErrorShowsFirstDetail() async {
        let api = client()
        StubURLProtocol.handler = { _ in (400, StubURLProtocol.json(["error": "Validation failed", "details": ["total_amount: too small"]])) }
        do {
            try await api.deleteReceipt(id: 1)
            XCTFail("expected error")
        } catch let error as APIError {
            XCTAssertEqual(error.message, "total_amount: too small")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testDeleteWithNoContentSucceeds() async throws {
        let api = client()
        StubURLProtocol.handler = { _ in (204, Data()) }
        try await api.deleteReceipt(id: 5)
        XCTAssertEqual(StubURLProtocol.requests.first?.httpMethod, "DELETE")
        XCTAssertEqual(StubURLProtocol.requests.first?.url?.path, "/api/receipts/5")
    }

    func testReceiptUploadIsMultipartWithImageField() async throws {
        let api = client()
        StubURLProtocol.handler = { _ in
            (200, StubURLProtocol.json([
                "image_key": "k", "image_hash": "h", "image_url": NSNull(), "duplicate_of": NSNull(),
                "draft": ["merchant_name": "X", "transaction_date": "2026-11-03", "currency": "GBP", "total_amount": 1,
                          "tax_amount": NSNull(), "category": "Other", "line_items": []],
            ] as [String: Any]))
        }
        let result = try await api.parseReceipt(jpeg: Data([0xFF, 0xD8, 0xFF, 0xE0]))
        XCTAssertEqual(result.draft.merchantName, "X")

        let request = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        XCTAssertTrue(body.contains("name=\"image\""))
    }
}

final class CognitoAuthTests: XCTestCase {
    override func setUp() {
        ["cognito_id_token", "cognito_access_token", "cognito_refresh_token", "cognito_expiry"].forEach { Keychain.set(nil, for: $0) }
    }

    private func auth() -> CognitoAuth { CognitoAuth(session: StubURLProtocol.session(), region: "us-east-1", clientID: "client123") }

    func testSignInStoresTokensAndSendsPasswordFlow() async throws {
        let auth = auth()
        StubURLProtocol.handler = { _ in
            (200, StubURLProtocol.json(["AuthenticationResult": ["IdToken": "id1", "AccessToken": "ac1", "RefreshToken": "rf1", "ExpiresIn": 3600]]))
        }
        try await auth.signIn(email: " User@Example.com ", password: "Secret-123")

        let request = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Amz-Target"), "AWSCognitoIdentityProviderService.InitiateAuth")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        XCTAssertEqual(body["AuthFlow"] as? String, "USER_PASSWORD_AUTH")
        XCTAssertEqual(body["ClientId"] as? String, "client123")
        XCTAssertEqual((body["AuthParameters"] as? [String: String])?["USERNAME"], "user@example.com")

        XCTAssertTrue(auth.hasSession)
        let token = try await auth.token()
        XCTAssertEqual(token, "id1") // still valid: no refresh call
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
    }

    func testWrongPasswordGivesFriendlyMessage() async {
        let auth = auth()
        StubURLProtocol.handler = { _ in (400, StubURLProtocol.json(["__type": "NotAuthorizedException", "message": "Incorrect username or password."])) }
        do {
            try await auth.signIn(email: "a@b.com", password: "x")
            XCTFail("expected error")
        } catch let error as AuthError {
            XCTAssertEqual(error.code, "NotAuthorizedException")
            XCTAssertEqual(error.message, "Incorrect email or password.")
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertFalse(auth.hasSession)
    }

    func testUnconfirmedUserErrorCodeIsExposed() async {
        let auth = auth()
        StubURLProtocol.handler = { _ in (400, StubURLProtocol.json(["__type": "com.amazonaws#UserNotConfirmedException", "message": "User is not confirmed."])) }
        do {
            try await auth.signIn(email: "a@b.com", password: "x")
            XCTFail("expected error")
        } catch let error as AuthError {
            XCTAssertEqual(error.code, "UserNotConfirmedException")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testExpiredTokenIsRefreshed() async throws {
        let auth = auth()
        Keychain.set("old", for: "cognito_id_token")
        Keychain.set("rf1", for: "cognito_refresh_token")
        Keychain.set("0", for: "cognito_expiry") // long expired
        StubURLProtocol.handler = { _ in (200, StubURLProtocol.json(["AuthenticationResult": ["IdToken": "fresh", "AccessToken": "ac2", "ExpiresIn": 3600]])) }

        let token = try await auth.token()
        XCTAssertEqual(token, "fresh")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(StubURLProtocol.requests.first).httpBody ?? Data()) as? [String: Any])
        XCTAssertEqual(body["AuthFlow"] as? String, "REFRESH_TOKEN_AUTH")
        XCTAssertEqual(Keychain.get("cognito_refresh_token"), "rf1") // refresh token is kept
    }

    func testRevokedRefreshTokenSignsOut() async throws {
        let auth = auth()
        Keychain.set("old", for: "cognito_id_token")
        Keychain.set("rf1", for: "cognito_refresh_token")
        Keychain.set("0", for: "cognito_expiry")
        StubURLProtocol.handler = { _ in (400, StubURLProtocol.json(["__type": "NotAuthorizedException", "message": "Refresh Token has been revoked"])) }

        let token = try await auth.token()
        XCTAssertNil(token)
        XCTAssertFalse(auth.hasSession)
    }

    func testSignUpReportsConfirmationRequired() async throws {
        let auth = auth()
        StubURLProtocol.handler = { _ in (200, StubURLProtocol.json(["UserConfirmed": false, "UserSub": "abc"])) }
        let confirmed = try await auth.signUp(email: "New@Example.com", password: "Secret-123")
        XCTAssertFalse(confirmed)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(StubURLProtocol.requests.first).httpBody ?? Data()) as? [String: Any])
        XCTAssertEqual(body["Username"] as? String, "new@example.com")
    }
}
