import SwiftUI

@main
struct LedgerAIApp: App {
    @State private var session: SessionStore
    @State private var lock: AppLock

    init() {
        // UI tests pass this to start from a signed-out state
        if CommandLine.arguments.contains("-ledgerai-reset-session") {
            ["cognito_id_token", "cognito_access_token", "cognito_refresh_token", "cognito_expiry", "local_token"].forEach { Keychain.set(nil, for: $0) }
            let defaults = UserDefaults.standard
            defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix("applock.") }.forEach { defaults.removeObject(forKey: $0) }
        }
        // Created after the reset above so a test run really starts unlocked and signed out
        _session = State(initialValue: SessionStore())
        _lock = State(initialValue: AppLock())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(lock)
                .task { await session.bootstrap() }
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppLock.self) private var lock
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content
            // While locked nothing underneath is tappable or readable by VoiceOver; the cover below is opaque
            .allowsHitTesting(!lock.isLocked)
            .accessibilityHidden(lock.isLocked)
            .overlay { if lock.isLocked { LockView() } }
            // Hide balances in the app-switcher snapshot
            .overlay { if scenePhase != .active && lock.isEnabled && !lock.isLocked { PrivacyShield() } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { lock.sceneDidEnterBackground() }
                if phase == .active { lock.sceneDidBecomeActive() }
            }
            .onChange(of: session.user?.userId) { _, id in if let id { lock.attach(userId: id) } }
            .onChange(of: session.state) { _, state in if state == .signedOut { lock.detach() } }
    }

    @ViewBuilder private var content: some View {
        switch session.state {
        case .loading:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .signedOut:
            AuthView()
        case .signedIn:
            if let user = session.user, user.country == nil { RegionSetupView() } else { MainTabView() }
        }
    }
}

struct MainTabView: View {
    @Environment(SessionStore.self) private var session
    /// Bumped after any receipt change so other tabs reload.
    @State private var dataVersion = 0

    var body: some View {
        TabView {
            HomeView(dataVersion: $dataVersion)
                .tabItem { Label("Home", systemImage: "house.fill") }
            AnalyticsView(dataVersion: $dataVersion)
                .tabItem { Label("Analytics", systemImage: "chart.bar.fill") }
            AccountView()
                .tabItem { Label("Account", systemImage: "person.fill") }
        }
    }
}
