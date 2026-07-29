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

## Confidentiality checklist

- `grep connect-src src-tauri/tauri.conf.json` → `connect-src 'none'`
- No `reqwest`/`hyper`/http crate in `Cargo.toml`
- No `node_modules` (frontend is dependency-free)
- `cargo audit` covers the entire runtime tree

## Remove

```sh
node hooks/install-hooks.js --remove   # restores your hooks
rm -rf ~/.deskpet
```
