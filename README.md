# deskpet 🦝

A private, offline **raccoon that lives on your Dock** and reacts to what you're
doing — which app you're in, your CPU and battery, the time of night, and (if you
want) your Claude Code sessions. He grows, gets hungry, naps, yawns, washes his
little hands, and gets *very* awake after midnight.

Built for people who want a desktop companion but won't run a closed-source app
that watches their screen. **deskpet never touches the network — the macOS kernel
forbids it.** Everything he notices stays on your machine.

> Personal project, shared as-is. Free to use and fork. Not accepting issues or
> pull requests — see [Contributing](#contributing).

## What he does

- **Watches your cursor** — his eyes follow the mouse everywhere.
- **Knows the room** — nosy in a browser, locked-in while you code, chatty in a terminal.
- **Reacts to your machine** — sweats when the CPU is pegged, gets *hangry* under
  25% battery, dramatically dying under 10%, happy and munching on the charger.
- **Nocturnal** — after midnight he wakes right up. Trash-panda hours.
- **Care loop** — hover him for a ring of actions: **Feed · Water · Pet · Edit**
  (recolor his coat + grass). Meters decay slowly, so you come back to a slightly
  needy critter — never a dead one. It's gentle by design.
- **Grows** — steady care sprouts fuller grass-hair on his head; neglect wilts it.
- **Lives like a real little guy** — idle yawns, scratches, hand-washing, glass-taps;
  wobbles and yells "wheee" when you fling him; scurries to a corner if you leave
  him floating mid-screen; remembers his age and brags about pets and late nights.
- **Optional Claude Code layer** — jumps when a task finishes, works while tools run.

He rides along over fullscreen apps and every Space, and he's **click-through** —
he never blocks your Dock or whatever's under him.

## Privacy — local-only, and provable

- **No network code in the binary.** `cargo tree -i reqwest` finds nothing;
  `nm target/release/deskpet | grep -i reqwest` is empty.
- **The webview can't reach the network:** `connect-src 'none'`.
- **The kernel forbids it:** he launches under `sandbox-exec -f deskpet.sb`
  (`(allow default)(deny network*)`). Prove it yourself:
  `sandbox-exec -f deskpet.sb curl https://example.com` → blocked.
- **No open sockets at runtime:** `lsof -nP -a -p "$(pgrep -x deskpet)" -i` → none.
- **No npm / `node_modules`** — the frontend is dependency-free plain JS.
- Everything he reads/writes is under `~/.deskpet/`; the only external commands he
  runs are local macOS tools (`lsappinfo`, `sysctl`, `pmset`).

## Install

Requirements: macOS, [Rust](https://rustup.rs) (`rustup`), and Xcode command line
tools (`xcode-select --install`).

```sh
git clone <this repo> deskpet && cd deskpet
sh build.sh
```

`build.sh` compiles a release binary, bundles `~/Applications/deskpet.app` (a
background agent — no Dock icon of its own), and installs a sandboxed LaunchAgent
that starts him at login and relaunches him if he crashes.

- **Stop:** `launchctl bootout gui/$(id -u)/app.deskpet`
- **Uninstall:** `rm -rf ~/Applications/deskpet.app ~/Library/LaunchAgents/app.deskpet.plist ~/.deskpet`

## Optional: Claude Code reactions

To have him jump when a Claude Code turn finishes and bustle while tools run:

```sh
node hooks/install-hooks.js     # backs up ~/.claude/settings.json first
# undo: node hooks/install-hooks.js --remove
```

## Try the moods by hand

```sh
printf celebrate > ~/.deskpet/state   # jumps
printf working   > ~/.deskpet/state   # busy
printf idle      > ~/.deskpet/state
```

## Built with

Vanilla JS + `<canvas>` (no framework, no assets — the raccoon is drawn in code),
[Tauri](https://tauri.app) v2 (Rust) for a tiny transparent always-on-top window,
and a macOS sandbox profile for the network guarantee. The character is 100%
original, drawn from scratch — no third-party mascots.

## Contributing

This is a personal thing I'm sharing because it's fun. **I'm not taking issues or
pull requests**, and I may not respond to them. You're very welcome to **fork it**
and make your own creature — that's encouraged.

## License

MIT — see [LICENSE](LICENSE).
