import XCTest
@testable import LedgerAI

/// Scripted stand-in for Face ID.
final class FakeAuthenticator: BiometricAuthenticator {
    var kind: BiometryKind = .faceID
    var canAuthenticate = true
    var outcomes: [AuthOutcome] = []
    private(set) var reasons: [String] = []

    func availability() -> BiometricAvailability {
        BiometricAvailability(kind: kind, canAuthenticate: canAuthenticate, unavailableReason: canAuthenticate ? nil : "Set up a passcode.")
    }

    func authenticate(reason: String) async -> AuthOutcome {
        reasons.append(reason)
        return outcomes.isEmpty ? .success : outcomes.removeFirst()
    }
}

@MainActor
final class AppLockTests: XCTestCase {
    private var defaults: UserDefaults!
    private var auth: FakeAuthenticator!
    private var clock: Date!

    override func setUp() {
        let name = "applock-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: name)
        defaults.removePersistentDomain(forName: name)
        auth = FakeAuthenticator()
        clock = Date(timeIntervalSince1970: 1_000_000)
    }

    private func makeLock() -> AppLock {
        AppLock(authenticator: auth, defaults: defaults, now: { [unowned self] in self.clock })
    }

    private func enabledLock(userId: Int = 1) async -> AppLock {
        let lock = makeLock()
        lock.attach(userId: userId)
        await lock.setEnabled(true)
        return lock
    }

    func testStartsOffAndUnlocked() {
        let lock = makeLock()
        lock.attach(userId: 1)
        XCTAssertFalse(lock.isEnabled)
        XCTAssertFalse(lock.isLocked)
    }

    func testEnablingRequiresSuccessfulAuthentication() async {
        let lock = makeLock()
        lock.attach(userId: 1)
        auth.outcomes = [.cancelled]
        await lock.setEnabled(true)
        XCTAssertFalse(lock.isEnabled, "cancelled prompt must not enable the lock")
        XCTAssertNil(lock.message, "cancelling is not an error")

        auth.outcomes = [.failed("Face not recognised")]
        await lock.setEnabled(true)
        XCTAssertFalse(lock.isEnabled)
        XCTAssertEqual(lock.message, "Face not recognised")

        auth.outcomes = [.success]
        await lock.setEnabled(true)
        XCTAssertTrue(lock.isEnabled)
        XCTAssertFalse(lock.isLocked, "enabling must not lock you out immediately")
        XCTAssertEqual(auth.reasons.last, "Turn on Face ID for LedgerAI")
    }

    func testCannotEnableWithoutPasscodeOrBiometrics() async {
        auth.canAuthenticate = false
        let lock = makeLock()
        lock.attach(userId: 1)
        await lock.setEnabled(true)
        XCTAssertFalse(lock.isEnabled)
        XCTAssertEqual(lock.message, "Set up a passcode.")
        XCTAssertTrue(auth.reasons.isEmpty, "no prompt should be shown when nothing can authenticate")
    }

    func testDisablingRequiresAuthentication() async {
        let lock = await enabledLock()
        auth.outcomes = [.cancelled]
        await lock.setEnabled(false)
        XCTAssertTrue(lock.isEnabled, "still on after a cancelled prompt")

        auth.outcomes = [.success]
        await lock.setEnabled(false)
        XCTAssertFalse(lock.isEnabled)
        XCTAssertEqual(auth.reasons.last, "Turn off Face ID for LedgerAI")
    }

    func testLocksOnlyAfterGracePeriodInBackground() async {
        let lock = await enabledLock()

        lock.sceneDidEnterBackground()
        clock = clock.addingTimeInterval(AppLock.gracePeriod - 1)
        lock.sceneDidBecomeActive()
        XCTAssertFalse(lock.isLocked, "a quick app switch must not lock")

        lock.sceneDidEnterBackground()
        clock = clock.addingTimeInterval(AppLock.gracePeriod + 1)
        lock.sceneDidBecomeActive()
        XCTAssertTrue(lock.isLocked)
    }

    func testBackgroundingWhenLockIsOffNeverLocks() {
        let lock = makeLock()
        lock.attach(userId: 1)
        lock.sceneDidEnterBackground()
        clock = clock.addingTimeInterval(3600)
        lock.sceneDidBecomeActive()
        XCTAssertFalse(lock.isLocked)
    }

    func testUnlockOutcomes() async {
        let lock = await enabledLock()
        lock.lockNow()
        XCTAssertTrue(lock.isLocked)

        auth.outcomes = [.failed("Try again")]
        let first = await lock.unlock()
        XCTAssertFalse(first)
        XCTAssertTrue(lock.isLocked)
        XCTAssertEqual(lock.message, "Try again")

        auth.outcomes = [.cancelled]
        let second = await lock.unlock()
        XCTAssertFalse(second)
        XCTAssertNil(lock.message, "message is cleared on the next attempt")

        auth.outcomes = [.success]
        let third = await lock.unlock()
        XCTAssertTrue(third)
        XCTAssertFalse(lock.isLocked)
        XCTAssertEqual(auth.reasons.last, "Unlock LedgerAI")
    }

    func testColdLaunchStartsLockedWhenEnabled() async {
        _ = await enabledLock(userId: 7)

        let relaunched = makeLock() // new process, session not restored yet
        XCTAssertTrue(relaunched.isEnabled)
        XCTAssertTrue(relaunched.isLocked, "must be locked before any data is shown")

        relaunched.attach(userId: 7) // session restored for the same user
        XCTAssertTrue(relaunched.isLocked, "restoring the session must not unlock")
    }

    func testSettingIsPerUser() async {
        _ = await enabledLock(userId: 1)
        let lock = makeLock()
        lock.attach(userId: 2)
        XCTAssertFalse(lock.isEnabled, "another account on the same phone has its own setting")
        XCTAssertFalse(lock.isLocked, "and a locked launch for user 1 must not trap user 2")
    }

    func testSignOutClearsLockButKeepsPreference() async {
        let lock = await enabledLock(userId: 3)
        lock.lockNow()
        lock.detach()
        XCTAssertFalse(lock.isLocked)
        XCTAssertFalse(makeLock().isLocked, "a signed-out app launches to the sign-in screen, not a lock screen")

        let again = makeLock()
        again.attach(userId: 3)
        XCTAssertTrue(again.isEnabled, "signing back in restores the user's choice")
    }

    func testDeletingAccountForgetsPreference() async {
        let lock = await enabledLock(userId: 4)
        lock.forget()
        let again = makeLock()
        again.attach(userId: 4)
        XCTAssertFalse(again.isEnabled)
    }

    func testLabelsFollowBiometryKind() {
        XCTAssertEqual(BiometryKind.faceID.name, "Face ID")
        XCTAssertEqual(BiometryKind.touchID.name, "Touch ID")
        XCTAssertEqual(BiometryKind.passcodeOnly.name, "Passcode")
        auth.kind = .touchID
        XCTAssertEqual(makeLock().name, "Touch ID")
    }
}
