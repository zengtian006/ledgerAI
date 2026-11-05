#!/bin/bash
# Runs the Face ID UI test in the Simulator against the local API (see README: LedgerAI-LocalAPI).
#   Needs: local API on :4000 with the seeded demo user (cd ../ledgerAI_h5/api && npm run dev:db / dev / seed)
#   ./scripts/test_faceid.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE="iPhone 17 Pro"
FLAG=/tmp/ledgerai-faceid-match
rm -f "$FLAG"

curl -fsS http://localhost:4000/api/health >/dev/null || { echo "Local API is not running on :4000" >&2; exit 1; }

xcrun simctl shutdown all >/dev/null 2>&1 || true
xcrun simctl boot "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b >/dev/null

# Enrol a face in the Simulator
xcrun simctl spawn booted notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit.enrollmentChanged

# Send "face matches" once a second, but only while the test has created the flag file
( while true; do
    [ -f "$FLAG" ] && xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit_Sim.pearl.match >/dev/null 2>&1
    sleep 1
  done ) &
LOOP=$!
trap 'kill $LOOP 2>/dev/null; rm -f "$FLAG"' EXIT

TEST_RUNNER_LEDGER_TEST_EMAIL=demo@example.com TEST_RUNNER_LEDGER_TEST_PASSWORD=password123 \
TEST_RUNNER_LEDGER_API_URL=http://localhost:4000 TEST_RUNNER_LEDGER_AUTH_MODE=local \
xcodebuild -project LedgerAI.xcodeproj -scheme LedgerAI \
  -destination "platform=iOS Simulator,name=$DEVICE" -derivedDataPath build \
  -only-testing:LedgerAIUITests/FaceIDLockUITests test 2>&1 | grep -vE "^\s*$" | grep -E "error|FAILED|Testing failed|Unable|Could not|No such" | head -15
