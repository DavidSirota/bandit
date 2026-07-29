# deskpet

A private, offline desktop creature for macOS that reacts to Claude Code — perks
up on a prompt, works while tools run, jumps when a turn finishes, sleeps when
you leave it alone. Built in-house so nothing ever leaves your machine. See
[`spec.md`](./spec.md) for the design and the confidentiality posture.

## Requirements

- macOS with Xcode command line tools (WKWebView is built in)
- Rust (`rustup`) — installs the toolchain Tauri builds against
- Tauri CLI v2

## Run it (dev)

```sh
# one-time: toolchain + CLI
source "$HOME/.cargo/env"
cargo install tauri-cli --version "^2.0" --locked   # or: npm i -D @tauri-apps/cli

# wire up hooks + state dir (backs up ~/.claude/settings.json first)
sh install.sh

# launch the creature (first build compiles Tauri — a few minutes, once)
cd src-tauri && cargo tauri dev
```

Then run anything in Claude Code and watch the creature react.

## Make a permanent app

```sh
cd src-tauri
python3 icons/make-icon.py          # writes icons/source.png
cargo tauri icon icons/source.png   # generates .icns + png sizes
cargo tauri build                   # produces deskpet.app + a .dmg
```

Move `src-tauri/target/release/bundle/macos/deskpet.app` to `/Applications`, then
System Settings → General → Login Items to launch it at login.

## Test the moods by hand

```sh
printf celebrate > ~/.deskpet/state   # jumps
printf working   > ~/.deskpet/state   # busy
printf sleep     > ~/.deskpet/state   # dozes
printf idle      > ~/.deskpet/state
```

## Install (permanent, sandboxed)

```sh
sh build.sh
```

Builds the release binary, bundles `~/Applications/deskpet.app` (a background
agent — no Dock icon of its own), and installs a LaunchAgent that starts it at
login and relaunches it if it crashes. It launches **inside a macOS sandbox
profile** (`deskpet.sb`) that denies all networking at the kernel level.

- stop: `launchctl bootout gui/$(id -u)/com.dsirota.deskpet`
- uninstall: `rm -rf ~/Applications/deskpet.app ~/Library/LaunchAgents/com.dsirota.deskpet.plist ~/.deskpet`

## Local-only, and how to verify it

- **No network code in the binary.** `cargo tree -i reqwest` finds nothing and
  `nm target/release/deskpet | grep -i reqwest` is empty. (Those names appear in
  `Cargo.lock` only as optional/dev records Cargo tracks but never compiles.)
- **The webview can't reach the network:** `connect-src 'none'` in
  `tauri.conf.json`.
- **The kernel forbids it too:** it runs under `sandbox-exec -f deskpet.sb`,
  which is `(allow default)(deny network*)`. Prove it:
  `sandbox-exec -f deskpet.sb curl https://example.com` → blocked.
- **No open sockets at runtime:** `lsof -nP -a -p "$(pgrep -x deskpet)" -i` → none.
- **No npm / `node_modules`** — the frontend is dependency-free.
- **Everything it reads/writes is under `~/.deskpet/`**; the only external
  commands it runs are local macOS tools (`lsappinfo`, `sysctl`, `pmset`).

## Remove

```sh
node hooks/install-hooks.js --remove   # restores your hooks
rm -rf ~/.deskpet
```
