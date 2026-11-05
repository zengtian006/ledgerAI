import Foundation

struct AuthError: LocalizedError, Equatable {
    let code: String
    let message: String
    var errorDescription: String? { message }
}

/// Two interchangeable sign-in backends: Amazon Cognito (production) and the API's built-in login (local dev).
protocol AuthBackend {
    var hasSession: Bool { get }
    var supportsPasswordReset: Bool { get }
    func token() async throws -> String?
    func signIn(email: String, password: String) async throws
    /// Returns true when the account is immediately usable (local mode); Cognito needs the emailed code first.
    func signUp(email: String, password: String) async throws -> Bool
    func confirm(email: String, code: String) async throws
    func resendCode(email: String) async throws
    func forgotPassword(email: String) async throws
    func resetPassword(email: String, code: String, newPassword: String) async throws
    func changePassword(old: String, new: String) async throws
    func reauthenticate(email: String, password: String) async throws
    func signOut() async
}

// MARK: - Cognito (REST, USER_PASSWORD_AUTH over TLS)

final class CognitoAuth: AuthBackend {
    private let session: URLSession
    private let endpoint: URL
    private let clientID: String

    private enum Key {
        static let id = "cognito_id_token"
        static let access = "cognito_access_token"
        static let refresh = "cognito_refresh_token"
        static let expiry = "cognito_expiry"
    }

    init(session: URLSession = .shared, region: String = AppConfig.cognitoRegion, clientID: String = AppConfig.cognitoClientID) {
        self.session = session
        self.endpoint = URL(string: "https://cognito-idp.\(region).amazonaws.com/")!
        self.clientID = clientID
    }

    var hasSession: Bool { Keychain.get(Key.refresh) != nil }
    var supportsPasswordReset: Bool { true }

    private static let messages: [String: String] = [
        "NotAuthorizedException": "Incorrect email or password.",
        "UserNotFoundException": "Incorrect email or password.",
        "UsernameExistsException": "An account with this email already exists.",
        "CodeMismatchException": "That code is incorrect.",
        "ExpiredCodeException": "That code has expired. Request a new one.",
        "InvalidPasswordException": "Password must be at least 8 characters with upper and lower case letters and a number.",
        "LimitExceededException": "Too many attempts. Please wait a while and try again.",
        "TooManyRequestsException": "Too many attempts. Please wait a while and try again.",
        "TooManyFailedAttemptsException": "Too many attempts. Please wait a while and try again.",
        "InvalidParameterException": "Please check your details and try again.",
    ]

    /// One Cognito JSON-RPC call (`X-Amz-Target`); throws AuthError with a friendly message.
    private func call(_ operation: String, _ payload: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-amz-json-1.1", forHTTPHeaderField: "Content-Type")
        request.setValue("AWSCognitoIdentityProviderService.\(operation)", forHTTPHeaderField: "X-Amz-Target")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await session.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let type = (json["__type"] as? String)?.split(separator: "#").last.map(String.init) ?? "Error"
            let fallback = json["message"] as? String ?? "Something went wrong. Please try again."
            throw AuthError(code: type, message: Self.messages[type] ?? fallback)
        }
        return json
    }

    private func storeTokens(_ result: [String: Any]) {
        if let id = result["IdToken"] as? String { Keychain.set(id, for: Key.id) }
        if let access = result["AccessToken"] as? String { Keychain.set(access, for: Key.access) }
        if let refresh = result["RefreshToken"] as? String { Keychain.set(refresh, for: Key.refresh) }
        let seconds = (result["ExpiresIn"] as? Double) ?? 3600
        Keychain.set(String(Date().addingTimeInterval(seconds).timeIntervalSince1970), for: Key.expiry)
    }

    private func authenticate(flow: String, parameters: [String: String]) async throws {
        let json = try await call("InitiateAuth", ["AuthFlow": flow, "ClientId": clientID, "AuthParameters": parameters])
        guard let result = json["AuthenticationResult"] as? [String: Any] else {
            throw AuthError(code: "ChallengeRequired", message: "This account needs extra verification that the app doesn't support yet.")
        }
        storeTokens(result)
    }

    func token() async throws -> String? {
        guard let refresh = Keychain.get(Key.refresh) else { return nil }
        let expiry = Keychain.get(Key.expiry).flatMap(Double.init) ?? 0
        if let id = Keychain.get(Key.id), expiry - Date().timeIntervalSince1970 > 60 { return id }
        do {
            try await authenticate(flow: "REFRESH_TOKEN_AUTH", parameters: ["REFRESH_TOKEN": refresh])
        } catch let error as AuthError where error.code == "NotAuthorizedException" {
            await signOut() // refresh token revoked or expired
            return nil
        }
        return Keychain.get(Key.id)
    }

    func signIn(email: String, password: String) async throws {
        try await authenticate(flow: "USER_PASSWORD_AUTH", parameters: ["USERNAME": normalized(email), "PASSWORD": password])
    }

    func signUp(email: String, password: String) async throws -> Bool {
        let json = try await call("SignUp", [
            "ClientId": clientID, "Username": normalized(email), "Password": password,
            "UserAttributes": [["Name": "email", "Value": normalized(email)]],
        ])
        return json["UserConfirmed"] as? Bool ?? false
    }

    func confirm(email: String, code: String) async throws {
        _ = try await call("ConfirmSignUp", ["ClientId": clientID, "Username": normalized(email), "ConfirmationCode": code.trimmed])
    }

    func resendCode(email: String) async throws {
        _ = try await call("ResendConfirmationCode", ["ClientId": clientID, "Username": normalized(email)])
    }

    func forgotPassword(email: String) async throws {
        _ = try await call("ForgotPassword", ["ClientId": clientID, "Username": normalized(email)])
    }

    func resetPassword(email: String, code: String, newPassword: String) async throws {
        _ = try await call("ConfirmForgotPassword", [
            "ClientId": clientID, "Username": normalized(email), "ConfirmationCode": code.trimmed, "Password": newPassword,
        ])
    }

    func changePassword(old: String, new: String) async throws {
        guard let access = Keychain.get(Key.access) else { throw AuthError(code: "NoSession", message: "Please sign in again.") }
        _ = try await call("ChangePassword", ["PreviousPassword": old, "ProposedPassword": new, "AccessToken": access])
    }

    func reauthenticate(email: String, password: String) async throws {
        // A throw-away sign-in that only verifies the password; the stored session is untouched on failure.
        let json = try await call("InitiateAuth", [
            "AuthFlow": "USER_PASSWORD_AUTH", "ClientId": clientID,
            "AuthParameters": ["USERNAME": normalized(email), "PASSWORD": password],
        ])
        guard json["AuthenticationResult"] != nil else { throw AuthError(code: "NotAuthorizedException", message: "Incorrect password.") }
    }

    func signOut() async {
        if let refresh = Keychain.get(Key.refresh) {
            _ = try? await call("RevokeToken", ["ClientId": clientID, "Token": refresh]) // best effort
        }
        [Key.id, Key.access, Key.refresh, Key.expiry].forEach { Keychain.set(nil, for: $0) }
    }

    private func normalized(_ email: String) -> String { email.trimmed.lowercased() }
}

// MARK: - Local dev API login

final class LocalAuth: AuthBackend {
    private let tokenKey = "local_token"
    var hasSession: Bool { Keychain.get(tokenKey) != nil }
    var supportsPasswordReset: Bool { false }

    private struct Credentials: Encodable { let email: String; let password: String }

    private func authenticate(_ path: String, email: String, password: String) async throws {
        let client = APIClient(session: APIClient.defaultSession())
        do {
            let response: LoginResponse = try await client.post(path, body: Credentials(email: email.trimmed.lowercased(), password: password))
            Keychain.set(response.token, for: tokenKey)
        } catch let error as APIError {
            throw AuthError(code: String(error.status), message: error.message)
        }
    }

    func token() async throws -> String? { Keychain.get(tokenKey) }
    func signIn(email: String, password: String) async throws { try await authenticate("/auth/login", email: email, password: password) }

    func signUp(email: String, password: String) async throws -> Bool {
        try await authenticate("/auth/register", email: email, password: password)
        return true
    }

    func confirm(email: String, code: String) async throws {}
    func resendCode(email: String) async throws {}
    func forgotPassword(email: String) async throws {}
    func resetPassword(email: String, code: String, newPassword: String) async throws {}
    func changePassword(old: String, new: String) async throws {}
    func reauthenticate(email: String, password: String) async throws {} // the API checks the password itself
    func signOut() async { Keychain.set(nil, for: tokenKey) }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
