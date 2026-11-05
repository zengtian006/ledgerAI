import XCTest

/// Captures App Store screenshots and paces the flows recorded as app previews (`xcrun simctl io <device> recordVideo`).
/// Needs the same credentials as LedgerAIUITests (TEST_RUNNER_LEDGER_TEST_EMAIL / _PASSWORD, optional local API variables).
/// Run on an iPhone 17 Pro simulator (1206 x 2622). Screenshots go to $TEST_RUNNER_LEDGER_SHOT_DIR (default /tmp/store-shots).
final class StoreMediaUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    private func shot(_ name: String) {
        let dir = env["LEDGER_SHOT_DIR"] ?? "/tmp/store-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }

    /// Writes a wall-clock marker so the recording can be trimmed to the scripted part of the flow.
    private func mark(_ name: String) {
        let dir = env["LEDGER_SHOT_DIR"] ?? "/tmp/store-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? String(Date().timeIntervalSince1970).write(toFile: "\(dir)/\(name).txt", atomically: true, encoding: .utf8)
    }

    private func launchSignedIn() throws -> XCUIApplication {
        let email = try XCTUnwrap(env["LEDGER_TEST_EMAIL"], "set TEST_RUNNER_LEDGER_TEST_EMAIL")
        let password = try XCTUnwrap(env["LEDGER_TEST_PASSWORD"], "set TEST_RUNNER_LEDGER_TEST_PASSWORD")
        let app = XCUIApplication()
        for key in ["LEDGER_API_URL", "LEDGER_AUTH_MODE"] { if let v = env[key] { app.launchEnvironment[key] = v } }
        app.launch()

        let emailField = app.textFields["Your email"]
        if emailField.waitForExistence(timeout: 8) {
            emailField.tap()
            emailField.typeText(email)
            let passwordField = app.secureTextFields["Required"]
            passwordField.tap()
            passwordField.typeText(password)
            app.buttons["Sign In"].tap()
            let notNow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Not Now"]
            if notNow.waitForExistence(timeout: 6) { notNow.tap() }
        }
        XCTAssertTrue(app.tabBars.buttons["Analytics"].waitForExistence(timeout: 20))
        waitForInsights(app)
        return app
    }

    private func waitForInsights(_ app: XCUIApplication) {
        let loading = app.staticTexts["Analysing your spending…"]
        let deadline = Date().addingTimeInterval(30)
        while loading.exists && Date() < deadline { sleep(1) }
        sleep(1)
    }

    private func openTab(_ name: String, _ app: XCUIApplication) {
        for _ in 0..<4 {
            app.tabBars.buttons[name].tap()
            sleep(1)
            if app.navigationBars[name].exists || app.staticTexts[name].exists { return }
        }
    }

    func testScreenshots() throws {
        let app = try launchSignedIn()
        shot("01-home")
        app.swipeUp(); sleep(1)
        shot("02-home-recent")
        app.swipeDown(); sleep(1)

        openTab("Analytics", app)
        app.segmentedControls.buttons["Monthly"].tap(); sleep(2)
        shot("03-analytics-monthly")
        app.swipeUp(); sleep(1)
        shot("04-analytics-merchants")
        app.swipeDown(); sleep(1)

        app.segmentedControls.buttons["Daily"].tap(); sleep(2)
        shot("05-analytics-daily")
        let firstRow = app.buttons.matching(NSPredicate(format: "label CONTAINS 'chevron' OR label CONTAINS[c] '£' OR label CONTAINS '$'")).firstMatch
        if firstRow.exists {
            firstRow.tap(); sleep(2)
            shot("06-review")
            app.buttons["Cancel"].tap(); sleep(1)
        }

        app.segmentedControls.buttons["Yearly"].tap(); sleep(2)
        shot("07-analytics-yearly")
        app.swipeUp(); sleep(1)
        shot("08-analytics-yearly-categories")

        // The Simulator can't draw flag emoji (the Region row shows empty boxes), so only the scrolled Account screen is captured
        openTab("Account", app); sleep(1)
        app.swipeUp(); app.swipeUp(); sleep(1)
        shot("09-account-settings")
    }

    /// Preview 1: dashboard and recent receipts.
    func testPreviewDashboard() throws {
        let app = try launchSignedIn()
        mark("start")
        sleep(3)
        app.swipeUp(); sleep(3)
        app.swipeDown(); sleep(2)
        openTab("Analytics", app); sleep(3)
        app.segmentedControls.buttons["Monthly"].tap(); sleep(4)
        app.swipeUp(); sleep(3)
        mark("end")
    }

    /// Preview 2: spending analytics across daily, monthly and yearly views.
    func testPreviewAnalytics() throws {
        let app = try launchSignedIn()
        mark("start")
        openTab("Analytics", app)
        app.segmentedControls.buttons["Daily"].tap(); sleep(3)
        app.segmentedControls.buttons["Monthly"].tap(); sleep(4)
        app.segmentedControls.buttons["Yearly"].tap(); sleep(4)
        app.swipeUp(); sleep(3)
        app.swipeDown(); sleep(2)
        mark("end")
    }

    /// Preview 3: browsing receipts by day and opening one to review it.
    func testPreviewReceipts() throws {
        let app = try launchSignedIn()
        mark("start")
        openTab("Analytics", app)
        app.segmentedControls.buttons["Daily"].tap(); sleep(3)
        let rows = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] '£' OR label CONTAINS '$'"))
        for index in [1, 0] where rows.count > index {
            rows.element(boundBy: index).tap(); sleep(4)
            app.buttons["Cancel"].tap(); sleep(2)
        }
        app.swipeUp(); sleep(3)
        app.swipeUp(); sleep(3)
        mark("end")
    }
}
