import Foundation
import Observation

/// App-wide sign-in state. Owns the auth backend and wires it into the shared API client.
@Observable @MainActor
final class SessionStore {
    enum State { case loading, signedOut, signedIn }

    private(set) var state: State = .loading
    private(set) var user: User?

    let auth: AuthBackend
    let api: APIClient

    init(auth: AuthBackend = AppConfig.usesCognito ? CognitoAuth() : LocalAuth(), api: APIClient = .shared) {
        self.auth = auth
        self.api = api
        api.tokenProvider = { [auth] in try await auth.token() }
        api.onUnauthorized = { [weak self] in Task { @MainActor in await self?.signOut() } }
    }

    /// Called once at launch: restores a saved session if the token still works.
    func bootstrap() async {
        guard auth.hasSession else { state = .signedOut; return }
        do {
            try await loadUser()
        } catch let error as APIError where error.status == 401 {
            await signOut()
        } catch {
            // Offline or a transient server error: keep the session and let screens retry
            state = .signedIn
        }
    }

    func loadUser() async throws {
        let response: MeResponse = try await api.get("/auth/me")
        user = response.user
        state = .signedIn
        await applyPendingRegion()
    }

    // MARK: Region (country + currency): chosen once at sign-up, then locked by the API

    private func pendingKey(_ email: String) -> String { "pending.region." + email.trimmed.lowercased() }

    /// Remembers the sign-up choice until the account can sign in (Cognito needs the emailed code first).
    func rememberRegion(email: String, country: String, currency: String) {
        UserDefaults.standard.set("\(country)|\(currency)", forKey: pendingKey(email))
    }

    private func applyPendingRegion() async {
        guard let current = user, current.country == nil else { return }
        let key = pendingKey(current.email)
        guard let saved = UserDefaults.standard.string(forKey: key) else { return }
        let parts = saved.split(separator: "|").map(String.init)
        defer { UserDefaults.standard.removeObject(forKey: key) }
        guard parts.count == 2 else { return }
        // On failure the user simply lands on the region setup screen instead
        try? await saveRegion(country: parts[0], currency: parts[1])
    }

    func saveRegion(country: String, currency: String) async throws {
        let updated = try await api.updateProfile(ProfileUpdate(displayName: user?.displayName ?? "", country: country, currency: currency))
        apply(profile: updated)
    }

    func signIn(email: String, password: String) async throws {
        try await auth.signIn(email: email, password: password)
        try await loadUser()
    }

    /// Returns true if the user is signed in already, false if an emailed code must be entered first.
    func signUp(email: String, password: String, region: RegionChoice? = nil) async throws -> Bool {
        let confirmed = try await auth.signUp(email: email, password: password)
        if let region, region.isComplete { rememberRegion(email: email, country: region.country, currency: region.currency) }
        if confirmed { try await loadUser() }
        return confirmed
    }

    func confirm(email: String, code: String, password: String) async throws {
        try await auth.confirm(email: email, code: code)
        try await signIn(email: email, password: password)
    }

    func signOut() async {
        await auth.signOut()
        user = nil
        state = .signedOut
    }

    func deleteAccount(password: String) async throws {
        guard let email = user?.email else { return }
        try await auth.reauthenticate(email: email, password: password)
        do {
            try await api.delete("/profile", body: DeleteAccountBody(password: password))
        } catch let error as APIError where error.status == 403 {
            throw AuthError(code: "403", message: "Incorrect password.")
        }
        await signOut()
    }

    func apply(profile: Profile) {
        guard var current = user else { return }
        current.displayName = profile.displayName
        current.country = profile.country
        current.currency = profile.currency
        user = current
    }
}
