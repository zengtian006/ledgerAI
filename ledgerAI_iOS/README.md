# LedgerAI iOS

Native SwiftUI client for LedgerAI. It uses **the same backend and API** as the web app (`https://www.ledgerai.click/api`):
snap a receipt → Gemini extracts the data → review → dashboards, reports and AI insights.

Follows the same conventions as the GBA Health iOS app: SwiftUI, **iOS 17+**, iPhone only, MVVM with `@Observable`,
automatic signing (team `W5ZUHEYQT3`), generated Info.plist.

## Features

- **Sign in / Create account / Verify email / Forgot password** (Amazon Cognito), session kept in the Keychain
- **Home**: month total vs last month, budget bar, AI insights, recent receipts
- **Snap Receipt** (camera) or **Choose from Library**; photos are compressed on-device (max 1600px JPEG) before upload
- **Review sheet**: edit merchant, date, category, totals, line items (negative prices for discounts), duplicate-image warning
- **Analytics**: Daily / Monthly (donut chart, top merchants) / Yearly (area chart, category change), CSV export via the share sheet
- **Account**: name, country → currency (overridable), export all data, change password, sign out, delete account

## Project layout

```
ledgerAI_iOS/
├── project.yml                 # XcodeGen definition (source of truth for LedgerAI.xcodeproj)
├── LedgerAI.xcodeproj          # generated; committed so Xcode opens it directly
├── LedgerAI/
│   ├── LedgerAIApp.swift       # @main, RootView, tab bar
│   ├── Core/                   # AppConfig, APIClient (+Endpoints), AuthBackend (Cognito/Local), Keychain, formatting, image tools
│   ├── Models/                 # Codable models for the API
│   ├── ViewModels/             # SessionStore, Home/Analytics/Account view models, receipt form
│   ├── Views/                  # AuthView, HomeView, ReviewView, AnalyticsView, AccountView
│   ├── Theme/                  # category colours / icons
│   └── Assets.xcassets/        # AppIcon, AccentColor
├── LedgerAITests/              # unit tests (models, formatting, API client, Cognito client with a stubbed network)
├── LedgerAIUITests/            # end-to-end walkthrough (needs credentials; see below)
└── scripts/make_icon.swift     # regenerates the app icon
```

## Setup

Requirements: Xcode 16+ (built with 26.3), iOS 17+ simulator or device.

```bash
brew install xcodegen          # only needed to regenerate the project
cd ledgerAI_iOS
xcodegen generate              # after editing project.yml or adding/removing files
open LedgerAI.xcodeproj        # ⌘R to run on a simulator
```

The app talks to production by default (`https://www.ledgerai.click`). Register in the app, enter the 6-digit code that is emailed
to you, then sign in. Choose your country and currency when you create the account; they can't be changed afterwards (accounts without one see a one-time setup screen).

> The Simulator has no camera: **Snap Receipt** explains this; use **Choose from Library** there. Test the camera on a real iPhone.

### Running against the local API

Use the **LedgerAI-LocalAPI** scheme. It sets `LEDGER_API_URL=http://localhost:4000` and `LEDGER_AUTH_MODE=local`, so the app uses the dev API's
built-in login instead of Cognito:

```bash
cd ../ledgerAI_h5/api && npm run dev:db      # terminal 1
cd ../ledgerAI_h5/api && npm run dev         # terminal 2
cd ../ledgerAI_h5/api && npm run seed        # demo data: demo@example.com / password123
```

## Authentication

The app signs in to Cognito with its own **iOS app client** (`ledgerai-ios`, created by `../ledgerAI_terraform`) using the
`USER_PASSWORD_AUTH` flow over TLS, calling the Cognito REST API directly (no AWS SDK dependency). The ID token is sent as
`Authorization: Bearer …` to the same API the web app uses; it is refreshed automatically with the refresh token. The client ID
in `Core/AppConfig.swift` is not a secret. If you recreate the Cognito client, update it from `terraform output cognito_ios_client_id`.

## Tests

```bash
xcodebuild -project LedgerAI.xcodeproj -scheme LedgerAI \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test -only-testing:LedgerAITests    # 28 unit tests
```

End-to-end walkthrough (signs in, visits every screen, saves screenshots to `/tmp/ledgerai-shots`; skipped without credentials):

```bash
TEST_RUNNER_LEDGER_TEST_EMAIL=you@example.com TEST_RUNNER_LEDGER_TEST_PASSWORD=... \
xcodebuild -project LedgerAI.xcodeproj -scheme LedgerAI \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test -only-testing:LedgerAIUITests
# add TEST_RUNNER_LEDGER_API_URL=http://localhost:4000 TEST_RUNNER_LEDGER_AUTH_MODE=local for the local API
```

## App Store Connect API scripts

`scripts/asc.mjs` is a dependency-free client for the App Store Connect API (it signs an ES256 token from your Team Key).
`scripts/register_bundle_id.mjs` registers `click.ledgerai.app` (safe to re-run; `--dry-run` only checks access):

```bash
export ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8   # keep the .p8 outside the project
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
node scripts/register_bundle_id.mjs
```

The API cannot create the app record or answer App Privacy questions; those two steps stay in the portal.

## Release to TestFlight (scripted via the App Store Connect API)

One-time portal steps, already done for LedgerAI: create the Team Key (see above), register the bundle ID, create the app record
(**"LedgerAI – Spend Tracker"**, bundle ID `click.ledgerai.app`, SKU `ledgerai-ios`, Full Access), and answer **App Privacy**.

Every release after that:

```bash
source ~/.appstoreconnect/env
./scripts/release.sh                       # next build number, archive, upload, wait until processed (signing via the API key)
node scripts/testflight.mjs distribute <build> --emails you@example.com   # internal group "Internal Testers" + What to Test
node scripts/testflight.mjs status         # list builds and their processing state
```

External testers (up to 10,000, needs a short Beta App Review): `distribute <build> --external --group "Beta Testers" --emails a@x.com,b@y.com`.
Before the first external build, set the beta review details (demo account) and a privacy policy URL in App Store Connect.
Internal testers must be members of your App Store Connect team and install the build through the TestFlight app.
Build numbers are chosen automatically (highest uploaded + 1), so `project.yml` does not need editing; change `MARKETING_VERSION` only for a new version.

Privacy answers: the app sends receipt photos and spending data to your own backend and to Google Gemini for parsing; no tracking, no third-party SDKs.
`ITSAppUsesNonExemptEncryption` is already set to `NO`.

## Notes

- Camera permission text lives in `project.yml` (`INFOPLIST_KEY_NSCameraUsageDescription`). The photo library uses the system picker and needs no permission.
- `NSAllowsLocalNetworking` is enabled so the local-API scheme can use plain HTTP to `localhost`; production traffic is HTTPS only.
- Not included yet: Sign in with Apple / passkeys, push notifications, dark-mode tuning beyond the system defaults, iPad layout (iPhone only, like the reference app).
