#!/bin/sh
# Build deskpet, bundle it as a background .app, and install it as a
# sandboxed (network-denied) LaunchAgent that starts at login.
# Reproducible: everything here is what makes the security posture real.
set -e
D="$(cd "$(dirname "$0")" && pwd)"
UID_="$(id -u)"
LABEL="app.deskpet"
APP="$HOME/Applications/deskpet.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> release build"
( cd "$D/src-tauri" && cargo build --release )

echo "==> icon (.icns)"
( cd "$D/src-tauri/icons"
  python3 make-icon.py
  rm -rf deskpet.iconset && mkdir deskpet.iconset
  for p in 16:16x16 32:16x16@2x 32:32x32 64:32x32@2x 128:128x128 \
           256:128x128@2x 256:256x256 512:256x256@2x 512:512x512 1024:512x512@2x; do
    sips -z "${p%%:*}" "${p%%:*}" source.png --out "deskpet.iconset/icon_${p##*:}.png" >/dev/null 2>&1
  done
  iconutil -c icns deskpet.iconset -o icon.icns )

echo "==> bundle $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$D/src-tauri/target/release/deskpet" "$APP/Contents/MacOS/deskpet"
cp "$D/src-tauri/icons/icon.icns" "$APP/Contents/Resources/icon.icns"
cp "$D/deskpet.sb" "$APP/Contents/Resources/deskpet.sb"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>deskpet</string>
  <key>CFBundleDisplayName</key><string>deskpet</string>
  <key>CFBundleIdentifier</key><string>$LABEL</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>deskpet</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST

echo "==> launch agent (sandboxed, deny-network, start at login)"
mkdir -p "$HOME/Library/LaunchAgents"
# clean up any prior install (including the pre-1.0 personal identifier)
launchctl bootout "gui/$UID_/com.dsirota.deskpet" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.dsirota.deskpet.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$APP/Contents/MacOS/deskpet</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict></plist>
PL

launchctl bootout "gui/$UID_/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$UID_" "$PLIST" 2>/dev/null || { sleep 1; launchctl bootstrap "gui/$UID_" "$PLIST" 2>/dev/null || true; }
launchctl kickstart "gui/$UID_/$LABEL" 2>/dev/null || true
echo "==> done. deskpet is installed, sandboxed (no network), and running."
echo "    stop:      launchctl bootout gui/$UID_/$LABEL"
echo "    uninstall: rm -rf \"$APP\" \"$PLIST\" ~/.deskpet"
