#!/bin/bash
# Archive the app, upload it to App Store Connect (TestFlight) and wait until it is processed.
#   source ~/.appstoreconnect/env
#   ./scripts/release.sh                 # picks the next free build number automatically
#   ./scripts/release.sh --no-wait       # upload only
# Afterwards:  node scripts/testflight.mjs distribute <build> --emails you@example.com
set -euo pipefail

cd "$(dirname "$0")/.."
: "${ASC_KEY_PATH:?run: source ~/.appstoreconnect/env}" "${ASC_KEY_ID:?}" "${ASC_ISSUER_ID:?}"

TEAM_ID=W5ZUHEYQT3
OUT=build/release
AUTH=(-allowProvisioningUpdates
      -authenticationKeyPath "$ASC_KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID"
      -authenticationKeyIssuerID "$ASC_ISSUER_ID")

BUILD=$(node scripts/testflight.mjs next-build)
echo "==> Release build number: $BUILD"

echo "==> Generating Xcode project"
xcodegen generate >/dev/null

rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> Archiving (Release, generic iOS device)"
xcodebuild archive \
  -project LedgerAI.xcodeproj -scheme LedgerAI -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/LedgerAI.xcarchive" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  "${AUTH[@]}" | tail -5

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

echo "==> Exporting and uploading to App Store Connect"
xcodebuild -exportArchive \
  -archivePath "$OUT/LedgerAI.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" \
  "${AUTH[@]}" | tail -8

echo "==> Uploaded build $BUILD"
if [ "${1:-}" != "--no-wait" ]; then
  echo "==> Waiting for App Store Connect to process it (usually 5-30 minutes)"
  node scripts/testflight.mjs wait "$BUILD"
  echo "==> Build $BUILD is ready. Next: node scripts/testflight.mjs distribute $BUILD --emails you@example.com"
fi
