#!/usr/bin/env bash
# Install the Paperclip wake bridge as a macOS LaunchAgent so it survives
# logout/reboot. Idempotent: re-running reloads the agent.
#
#   scripts/paperclip/install-wake-bridge.sh            # install + start
#   scripts/paperclip/install-wake-bridge.sh --uninstall
#
# Requires: node on PATH, ~/.paperclip-onboarding/paperclip.env with
# PAPERCLIP_API_URL + PAPERCLIP_API_KEY (+ optional PAPERCLIP_COMPANY_ID).
set -euo pipefail

LABEL="com.lekhan.wake-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(command -v node)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/paperclip/wake-bridge.mjs"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "wake bridge uninstalled"
  exit 0
fi

[[ -x "$NODE_BIN" ]] || { echo "node not found on PATH" >&2; exit 1; }
[[ -f "$SCRIPT" ]] || { echo "missing $SCRIPT" >&2; exit 1; }
[[ -f "$HOME/.paperclip-onboarding/paperclip.env" ]] || {
  echo "missing ~/.paperclip-onboarding/paperclip.env — create it with PAPERCLIP_API_URL and PAPERCLIP_API_KEY" >&2
  exit 1
}

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$SCRIPT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/.paperclip-onboarding/wake-bridge.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/.paperclip-onboarding/wake-bridge.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "wake bridge installed: $LABEL"
echo "log:   ~/.paperclip-onboarding/wake-bridge.log"
echo "state: ~/.paperclip-onboarding/wake-bridge-state.json"
