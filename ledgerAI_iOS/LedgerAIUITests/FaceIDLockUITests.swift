import XCTest

/// Face ID app lock, end to end in the Simulator. It needs a signed-in account, a Simulator with an enrolled face, and
/// something that sends "face matches" while the test runs. scripts/test_faceid.sh sets all of that up.
///
/// Matching is switched on/off through a flag file the shell loop watches, so the test controls when Face ID succeeds.
final class FaceIDLockUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private let matchFlag = "/tmp/ledgerai-faceid-match"

    private func faceMatches(_ on: Bool) {
        if on { FileManager.default.createFile(atPath: matchFlag, contents: Data()) } else { try? FileManager.default.removeItem(atPath: matchFlag) }
    }

    private func shot(_ name: String) {
        let dir = env["LEDGER_SHOT_DIR"] ?? "/tmp/ledgerai-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }

    private func launch(reset: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        for key in ["LEDGER_API_URL", "LEDGER_AUTH_MODE"] { if let v = env[key] { app.launchEnvironment[key] = v } }
        if reset { app.launchArguments += ["-ledgerai-reset-session"] }
        app.launch()
        return app
    }

    private func type(_ text: String, into field: XCUIElement, _ app: XCUIApplication) {
        field.tap()
        _ = app.keyboards.firstMatch.waitForExistence(timeout: 5)
        usleep(500_000)
        field.typeText(text)
    }

    private func openAccount(_ app: XCUIApplication) {
        for _ in 0..<4 {
            app.tabBars.buttons["Account"].tap()
            if app.staticTexts["Region"].waitForExistence(timeout: 3) { return }
        }
        XCTFail("could not open Account")
    }

    private func faceIDSwitch(_ app: XCUIApplication) -> XCUIElement {
        let toggle = app.switches["applock-toggle"]
        app.swipeUp()
        app.swipeUp()
        sleep(1)
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "Face ID switch not found")
        return toggle
    }

    private func flip(_ toggle: XCUIElement) {
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
    }

    func testEnableLockRelaunchUnlockAndDisable() throws {
        let email = try XCTUnwrap(env["LEDGER_TEST_EMAIL"], "set TEST_RUNNER_LEDGER_TEST_EMAIL")
        let password = try XCTUnwrap(env["LEDGER_TEST_PASSWORD"], "set TEST_RUNNER_LEDGER_TEST_PASSWORD")
        faceMatches(true)
        defer { faceMatches(false) }

        // 1. Sign in (fresh state)
        var app = launch(reset: true)
        let emailField = app.textFields["Your email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 15))
        type(email, into: emailField, app)
        type(password, into: app.secureTextFields["Required"], app)
        app.buttons["Sign In"].tap()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 20))

        // 2. Turn Face ID on (the simulated face matches)
        openAccount(app)
        var toggle = faceIDSwitch(app)
        XCTAssertEqual(toggle.value as? String, "0", "starts off")
        shot("faceid-1-security-off")
        flip(toggle)
        sleep(2)
        shot("faceid-1b-after-tap")
        let enabled = NSPredicate(format: "value == '1'")
        expectation(for: enabled, evaluatedWith: toggle)
        waitForExpectations(timeout: 15)
        shot("faceid-2-security-on")

        // 3. Relaunch: the app must be locked, and nothing behind it reachable, until the face matches
        faceMatches(false)
        app.terminate()
        app = launch()
        let unlock = app.buttons["unlock-button"]
        XCTAssertTrue(unlock.waitForExistence(timeout: 15), "lock screen should appear on launch")
        XCTAssertFalse(app.tabBars.buttons["Analytics"].isHittable, "tabs must not be reachable while locked")
        sleep(2)
        shot("faceid-3-locked")

        // 4. Face matches -> unlocked
        faceMatches(true)
        XCTAssertTrue(app.tabBars.buttons["Analytics"].waitForExistence(timeout: 20), "app should unlock when the face matches")
        XCTAssertFalse(unlock.exists)
        shot("faceid-4-unlocked")

        // 5. Turn it off again (needs the face), relaunch: straight in, no lock
        openAccount(app)
        toggle = faceIDSwitch(app)
        XCTAssertEqual(toggle.value as? String, "1")
        flip(toggle)
        expectation(for: NSPredicate(format: "value == '0'"), evaluatedWith: toggle)
        waitForExpectations(timeout: 15)
        shot("faceid-5-off-again")

        faceMatches(false)
        app.terminate()
        app = launch()
        XCTAssertTrue(app.tabBars.buttons["Analytics"].waitForExistence(timeout: 20), "no lock once it is switched off")
        XCTAssertFalse(app.buttons["unlock-button"].exists)
    }
}
