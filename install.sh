#!/bin/sh
# deskpet setup — make the state script runnable, wire up Claude Code hooks,
# and (optionally) launch the creature at login. All local, no network.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> making deskpet-state executable"
chmod +x "$HERE/hooks/deskpet-state"

echo "==> seeding state dir"
mkdir -p "$HOME/.deskpet"
printf 'idle' > "$HOME/.deskpet/state"

echo "==> installing Claude Code hooks (backs up settings.json first)"
node "$HERE/hooks/install-hooks.js"

cat <<EOF

Done. Next:
  1. Build the app once Rust is ready:   cd "$HERE/src-tauri" && cargo tauri dev
  2. To make a permanent .app:           cargo tauri build   (see README)
  3. Launch-at-login: System Settings > General > Login Items > add deskpet.app

To remove the hooks later:  node "$HERE/hooks/install-hooks.js" --remove
EOF
