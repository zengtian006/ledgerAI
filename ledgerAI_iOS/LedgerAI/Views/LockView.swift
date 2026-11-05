import SwiftUI

/// Full-screen cover shown while the app is locked.
struct LockView: View {
    @Environment(AppLock.self) private var lock
    @Environment(SessionStore.self) private var session
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image("AppIcon-Preview")
                .resizable().scaledToFit().frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: .green.opacity(0.25), radius: 10, y: 5)
            Text("LedgerAI is locked").font(.title2.weight(.semibold))
            Text("Your receipts and spending are hidden until you unlock.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)

            if let message = lock.message {
                Text(message).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }

            Button {
                Task { await lock.unlock() }
            } label: {
                Label("Unlock with \(lock.name)", systemImage: lock.kind.symbol)
                    .font(.headline).frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .disabled(lock.isAuthenticating)
            .accessibilityIdentifier("unlock-button")

            Spacer()

            // Escape hatch if biometrics and the passcode can't be used
            Button("Sign out") { Task { await session.signOut() } }
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(28)
        .frame(maxWidth: 440)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .onAppear { promptIfActive() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { promptIfActive() } }
    }

    /// Face ID can't be shown while the app is not active, so wait for the scene to become active first.
    private func promptIfActive() {
        guard scenePhase == .active else { return }
        Task { await lock.unlock() }
    }
}

/// Covers the app in the iOS app switcher so balances aren't visible in the snapshot.
struct PrivacyShield: View {
    var body: some View {
        ZStack {
            Color(.systemBackground)
            Image("AppIcon-Preview")
                .resizable().scaledToFit().frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .ignoresSafeArea()
    }
}
