#!/bin/sh
# Bandit — one-line installer. No build tools needed: this downloads the
# prebuilt app, drops it in ~/Applications, and starts it. It runs sandboxed
# with all networking denied by the kernel, so it stays fully offline.
#
#   curl -fsSL https://raw.githubusercontent.com/DavidSirota/bandit/main/install.sh | sh
#
set -e
LABEL="app.bandit"
APP="$HOME/Applications/Bandit.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
URL="https://github.com/DavidSirota/bandit/releases/latest/download/Bandit.app.zip"

printf '\n\xF0\x9F\xA6\x9D  Installing Bandit...\n'
mkdir -p "$HOME/Applications" "$HOME/Library/LaunchAgents"
TMP="$(mktemp -d)"
curl -fsSL "$URL" -o "$TMP/Bandit.app.zip"

# stop any running copy first
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
pkill -x deskpet 2>/dev/null || true

rm -rf "$APP"
ditto -x -k "$TMP/Bandit.app.zip" "$HOME/Applications"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
rm -rf "$TMP"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/deskpet</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict></plist>
PL

launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || { sleep 1; launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true; }
launchctl kickstart "gui/$(id -u)/$LABEL" 2>/dev/null || true

printf '\xE2\x9C\x85  Bandit is on your Dock. Hover him for the menu.\n'
printf '   Uninstall:  launchctl bootout gui/%s/%s ; rm -rf "%s" "%s" ~/.deskpet\n\n' "$(id -u)" "$LABEL" "$APP" "$PLIST"
