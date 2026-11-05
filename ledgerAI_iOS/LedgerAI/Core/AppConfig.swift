import Foundation

/// Build-time defaults point at production. The "LedgerAI-LocalAPI" scheme overrides them with
/// environment variables so the app can talk to the local dev API (AUTH_MODE=local).
enum AppConfig {
    private static let env = ProcessInfo.processInfo.environment

    static let apiBaseURL: URL = {
        if let value = env["LEDGER_API_URL"], let url = URL(string: value) { return url }
        return URL(string: "https://www.ledgerai.click")!
    }()

    static let cognitoRegion = "us-east-1"

    /// App client created for iOS by ledgerAI_terraform (`terraform output cognito_ios_client_id`).
    /// Not a secret: it only identifies the app to Cognito.
    static let cognitoClientID = env["LEDGER_COGNITO_CLIENT_ID"] ?? "5s1tdki4k7738v3rar7cnkq1qo"

    static var usesCognito: Bool { env["LEDGER_AUTH_MODE"] != "local" && !cognitoClientID.isEmpty }

    static let passwordHint = usesCognito
        ? "At least 8 characters, with upper and lower case letters and a number."
        : "Use at least 8 characters."
}
