import Foundation
import LocalAuthentication
import Observation

// MARK: - Biometrics abstraction (so the lock rules can be unit-tested without a real Face ID)

enum BiometryKind: Equatable {
    case faceID, touchID, opticID, passcodeOnly, unavailable

    var name: String {
        switch self {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .passcodeOnly, .unavailable: return "Passcode"
        }
    }

    var symbol: String {
        switch self {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        case .passcodeOnly, .unavailable: return "lock.fill"
        }
    }
}

struct BiometricAvailability: Equatable {
    var kind: BiometryKind
    /// False when the device has no passcode at all, so nothing can protect the app.
    var canAuthenticate: Bool
    var unavailableReason: String?
}

enum AuthOutcome: Equatable {
    case success
    case cancelled
    case failed(String)
    case unavailable(String)
}

protocol BiometricAuthenticator {
    func availability() -> BiometricAvailability
    func authenticate(reason: String) async -> AuthOutcome
}

/// Face ID / Touch ID / Optic ID, falling back to the device passcode (`.deviceOwnerAuthentication`),
/// so someone whose face isn't recognised can still get in and users without biometrics are not locked out.
struct SystemAuthenticator: BiometricAuthenticator {
    func availability() -> BiometricAvailability {
        let biometricContext = LAContext()
        var biometricError: NSError?
        let hasBiometrics = biometricContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &biometricError)

        var passcodeError: NSError?
        let canUseAny = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &passcodeError)

        var kind: BiometryKind = .unavailable
        if hasBiometrics {
            switch biometricContext.biometryType {
            case .faceID: kind = .faceID
            case .touchID: kind = .touchID
            case .opticID: kind = .opticID
            default: kind = .passcodeOnly
            }
        } else if canUseAny {
            kind = .passcodeOnly
        }

        return BiometricAvailability(
            kind: kind,
            canAuthenticate: canUseAny,
            unavailableReason: canUseAny ? nil : "Set up Face ID or a passcode in the iOS Settings app to use this."
        )
    }

    func authenticate(reason: String) async -> AuthOutcome {
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        do {
            let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
            return ok ? .success : .failed("Authentication failed.")
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .appCancel, .systemCancel:
                return .cancelled
            case .passcodeNotSet, .biometryNotAvailable, .biometryNotEnrolled:
                return .unavailable("Set up Face ID or a passcode in the iOS Settings app to use this.")
            default:
                return .failed(error.localizedDescription)
            }
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}

// MARK: - App lock

/// Face ID app lock.
///
/// - The on/off choice is remembered per signed-in user on this device (UserDefaults).
/// - When on, the app starts locked, and locks again after being in the background for longer than `gracePeriod`.
/// - Turning it on or off requires authenticating, so a borrowed unlocked phone can't switch it off.
///
/// This gates the app's screens. It is a privacy/convenience lock; the sign-in tokens themselves stay in the Keychain.
@Observable @MainActor
final class AppLock {
    static let gracePeriod: TimeInterval = 10
    static let lastUserKey = "applock.lastUserId"
    static func enabledKey(for userId: Int) -> String { "applock.enabled.\(userId)" }

    private(set) var isEnabled = false
    private(set) var isLocked = false
    private(set) var availability: BiometricAvailability
    private(set) var isAuthenticating = false
    /// Last problem to show the user (cleared on the next attempt).
    var message: String?

    private let authenticator: BiometricAuthenticator
    private let defaults: UserDefaults
    private let now: () -> Date
    private var userId: Int?
    private var backgroundedAt: Date?

    init(authenticator: BiometricAuthenticator = SystemAuthenticator(), defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.authenticator = authenticator
        self.defaults = defaults
        self.now = now
        self.availability = authenticator.availability()

        // Start locked before the session has even been restored, so no data flashes up on launch
        let last = defaults.integer(forKey: Self.lastUserKey)
        if last != 0, defaults.bool(forKey: Self.enabledKey(for: last)) {
            userId = last
            isEnabled = true
            isLocked = true
        }
    }

    var kind: BiometryKind { availability.kind }
    var name: String { availability.kind.name }

    // MARK: Session

    /// Called once the signed-in user is known.
    func attach(userId id: Int) {
        userId = id
        defaults.set(id, forKey: Self.lastUserKey)
        isEnabled = defaults.bool(forKey: Self.enabledKey(for: id))
        if !isEnabled { isLocked = false }
        refreshAvailability()
    }

    /// Called when nobody is signed in (sign-out, expired session): nothing to protect.
    func detach() {
        userId = nil
        isEnabled = false
        isLocked = false
        backgroundedAt = nil
        defaults.removeObject(forKey: Self.lastUserKey)
    }

    /// Called when the account is deleted.
    func forget() {
        if let userId { defaults.removeObject(forKey: Self.enabledKey(for: userId)) }
        detach()
    }

    func refreshAvailability() { availability = authenticator.availability() }

    // MARK: Settings toggle

    /// Turns the lock on or off. Both directions require a successful authentication.
    func setEnabled(_ enable: Bool) async {
        guard let userId, enable != isEnabled, !isAuthenticating else { return }
        message = nil
        refreshAvailability()
        if enable, !availability.canAuthenticate {
            message = availability.unavailableReason
            return
        }
        let reason = enable ? "Turn on \(name) for LedgerAI" : "Turn off \(name) for LedgerAI"
        guard await run(reason: reason) else { return }
        isEnabled = enable
        defaults.set(enable, forKey: Self.enabledKey(for: userId))
        isLocked = false
    }

    // MARK: Locking

    func sceneDidEnterBackground() {
        guard isEnabled, !isLocked else { return }
        backgroundedAt = now()
    }

    func sceneDidBecomeActive() {
        defer { backgroundedAt = nil }
        guard isEnabled, !isLocked, let backgroundedAt else { return }
        if now().timeIntervalSince(backgroundedAt) > Self.gracePeriod { isLocked = true }
    }

    func lockNow() { if isEnabled { isLocked = true } }

    /// Prompts for Face ID. Returns true when the app is unlocked afterwards.
    @discardableResult
    func unlock() async -> Bool {
        guard isLocked, !isAuthenticating else { return !isLocked }
        message = nil
        if await run(reason: "Unlock LedgerAI") { isLocked = false }
        return !isLocked
    }

    // MARK: Internals

    private func run(reason: String) async -> Bool {
        isAuthenticating = true
        defer { isAuthenticating = false }
        switch await authenticator.authenticate(reason: reason) {
        case .success: return true
        case .cancelled: return false
        case .failed(let text), .unavailable(let text):
            message = text
            return false
        }
    }
}
