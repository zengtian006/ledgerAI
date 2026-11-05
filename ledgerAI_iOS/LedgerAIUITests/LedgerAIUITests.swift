import XCTest

/// End-to-end smoke test: signs in against a real API and walks through every screen.
/// Needs credentials, so it is skipped unless they are supplied:
///   TEST_RUNNER_LEDGER_TEST_EMAIL / TEST_RUNNER_LEDGER_TEST_PASSWORD
/// and optionally TEST_RUNNER_LEDGER_API_URL + TEST_RUNNER_LEDGER_AUTH_MODE=local for the local dev API.
/// Screenshots are written to $TEST_RUNNER_LEDGER_SHOT_DIR (default /tmp/ledgerai-shots).
final class LedgerAIUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    private func shot(_ name: String) {
        let dir = env["LEDGER_SHOT_DIR"] ?? "/tmp/ledgerai-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }

    /// Types into a field once the keyboard is up, and re-types if the simulator dropped characters.
    private func enter(_ text: String, into field: XCUIElement, _ app: XCUIApplication, verify: Bool = true) {
        for _ in 0..<3 {
            field.tap()
            _ = app.keyboards.firstMatch.waitForExistence(timeout: 5)
            usleep(500_000)
            field.typeText(text)
            if !verify || (field.value as? String) == text { return }
            field.press(forDuration: 1.2)
            app.menuItems["Select All"].firstMatch.tap()
            field.typeText(XCUIKeyboardKey.delete.rawValue)
        }
    }

    /// Switches tabs, retrying because a tap can be swallowed while a scroll is still settling.
    private func tapTab(_ name: String, _ app: XCUIApplication, expecting marker: XCUIElement) {
        for _ in 0..<4 {
            app.tabBars.buttons[name].tap()
            if marker.waitForExistence(timeout: 3) { return }
        }
        XCTFail("could not open the \(name) tab")
    }

    /// Needs no credentials: captures the signed-out screens (sign in, create account).
    func testAuthScreens() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-ledgerai-reset-session"]
        app.launch()
        let emailField = app.textFields["Your email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 15))
        sleep(1)
        shot("auth-1-signin")
        app.buttons["New here? Create Account"].tap()
        XCTAssertTrue(app.buttons["Create Account"].waitForExistence(timeout: 5))
        sleep(1)
        shot("auth-2-register")
    }

    func testSignInAndBrowse() throws {
        let email = try XCTUnwrap(env["LEDGER_TEST_EMAIL"], "set TEST_RUNNER_LEDGER_TEST_EMAIL")
        let password = try XCTUnwrap(env["LEDGER_TEST_PASSWORD"], "set TEST_RUNNER_LEDGER_TEST_PASSWORD")

        let app = XCUIApplication()
        for key in ["LEDGER_API_URL", "LEDGER_AUTH_MODE"] { if let v = env[key] { app.launchEnvironment[key] = v } }
        app.launch()

        // Sign in (skipped when a previous run left a saved session)
        let emailField = app.textFields["Your email"]
        let analyticsTab = app.tabBars.buttons["Analytics"]
        if emailField.waitForExistence(timeout: 8) {
            shot("01-signin")
            enter(email, into: emailField, app)
            let passwordField = app.secureTextFields["Required"]
            enter(password, into: passwordField, app, verify: false)
            app.buttons["Sign In"].tap()
        }

        // Home
        XCTAssertTrue(analyticsTab.waitForExistence(timeout: 20), "did not reach the main screen after signing in")
        XCTAssertTrue(app.buttons["Snap Receipt"].waitForExistence(timeout: 10))
        sleep(2)
        shot("02-home")
        app.swipeUp()
        sleep(1)
        shot("03-home-scrolled")

        // Analytics: monthly, daily (open a receipt), yearly
        tapTab("Analytics", app, expecting: app.segmentedControls.buttons["Monthly"])
        sleep(2)
        shot("04-analytics-monthly")
        app.segmentedControls.buttons["Daily"].tap()
        sleep(2)
        shot("05-analytics-daily")
        let firstRow = app.buttons.matching(NSPredicate(format: "label CONTAINS 'chevron' OR label CONTAINS[c] '£' OR label CONTAINS '$'")).firstMatch
        if firstRow.exists {
            firstRow.tap()
            sleep(2)
            shot("06-review-sheet")
            app.buttons["Cancel"].tap()
            sleep(1)
        }
        app.segmentedControls.buttons["Yearly"].tap()
        sleep(2)
        shot("07-analytics-yearly")

        // Account
        tapTab("Account", app, expecting: app.staticTexts["Region"])
        sleep(2)
        shot("08-account")
        app.swipeUp()
        sleep(1)
        shot("09-account-bottom")
    }

    func testTmpAccountShots() throws {
        let app = XCUIApplication()
        app.launchEnvironment["LEDGER_API_URL"] = "http://localhost:8099"
        app.launchEnvironment["LEDGER_AUTH_MODE"] = "local"
        app.launchArguments += ["-ledgerai-reset-session"]
        app.launch()
        let f = app.textFields["Your email"]
        XCTAssertTrue(f.waitForExistence(timeout: 15))
        f.tap(); f.typeText("tian@example.com")
        let pw = app.secureTextFields["Required"]; pw.tap(); pw.typeText("password123")
        app.buttons["Sign In"].tap()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Account"].tap()
        sleep(2)
        func shot(_ n: String) { try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/mock/\(n).png")) }
        shot("a1")
        app.swipeUp(); sleep(1); shot("a2")
        app.swipeDown(); sleep(1)
        app.buttons["Region"].firstMatch.tap(); sleep(1); shot("a3")
        app.navigationBars.buttons.firstMatch.tap(); sleep(1)
        app.buttons["Personal Information"].firstMatch.tap(); sleep(1); shot("a4")
    }
}
