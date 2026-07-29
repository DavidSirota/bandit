<h1 align="center">🦝 Bandit</h1>

<p align="center">
  <b>A little raccoon who lives on your Mac's Dock and reacts to your day.</b><br>
  He watches your cursor, knows what app you're in, sweats when your CPU spikes,
  gets hangry when your battery's low, and wakes <i>all the way up</i> after midnight.<br>
  Feed him, water him, pet him — and he never, ever phones home.
</p>

<p align="center">
  <!-- drop a demo.gif here — a few seconds of Bandit reacting sells the whole thing -->
  <img src="docs/demo.gif" alt="Bandit on the Dock" width="420" onerror="this.style.display='none'">
</p>

---

## Why you'd actually want this

Most desktop pets are cute for a day. Bandit sticks around because he's *aware* —
he reacts to what you're really doing, so glancing at him tells you something,
and he grows on you (literally: care for him and he sprouts a fuller head of
grass). And unlike the wave of "companion" apps that quietly watch your screen
and ship it somewhere, **Bandit physically cannot talk to the internet.** The
macOS kernel forbids it. What he notices never leaves your Mac. (Proof below.)

He's also just a good little guy. He yawns. He washes his tiny hands. He tips
over and yells "wheee" when you fling him across the screen.

## What he reacts to

- **Your cursor** — his eyes follow the mouse everywhere.
- **What you're doing** — nosy in a browser, locked-in while you code, chatty in a terminal, and he'll call you out for app-hopping.
- **Your machine** — sweats when the CPU is pegged, gets *hangry* under 25% battery, dramatically dying under 10%, happy and munching on the charger.
- **The clock** — greets you morning/afternoon/evening, and after midnight the raccoon *wakes up*. Trash-panda hours. 🌙
- **Being cared for** — hover him for **Feed · Water · Pet · Edit** (recolor his coat + grass). Meters drift slowly while you're away, so you come back to a slightly needy little guy. It's gentle — he sulks and droops, but he never dies.
- **His own history** — he remembers how long you've been together and brags about the pets and late nights.

He floats over fullscreen apps and every Space, sits on your Dock without an app
icon of his own, and is fully **click-through** — he never blocks anything.
Fling him anywhere; leave him floating and he scurries back to a corner.

## Actually private — and you can prove it

Bandit is the anti-spyware desktop pet. Every claim here is checkable:

| Claim | Check it yourself |
|---|---|
| No networking code in the app | `nm Bandit.app/Contents/MacOS/* \| grep -i reqwest` → empty |
| The webview can't reach the net | `connect-src 'none'` in the config |
| **The kernel forbids all networking** | He runs under `sandbox-exec` with `(deny network*)` — `sandbox-exec -f deskpet.sb curl example.com` → blocked |
| No open connections, ever | `lsof -nP -a -p "$(pgrep -x Bandit)" -i` → nothing |
| No hidden dependencies | No `node_modules`; the raccoon is drawn in pure `<canvas>` code |

Everything he reads stays local (your cursor, the frontmost app's name, CPU and
battery via macOS's own tools). It's written to a single folder, `~/.deskpet/`.

## Get Bandit

### The easy way (no tools needed)

1. Download **Bandit.app** from the [Releases](../../releases) page.
2. Drag it into your **Applications** folder.
3. **Right-click it → Open** the first time (it's a free indie app, so macOS asks
   once), then click **Open**.

That's it — he hops onto your Dock and stays there. He even network-sandboxes
himself, so you get the full privacy guarantee just by double-clicking.

To have him come back every time you restart, add him in
**System Settings → General → Login Items → +**.

### Build it yourself

Requirements: [Rust](https://rustup.rs) and Xcode command line tools
(`xcode-select --install`).

```sh
git clone https://github.com/DavidSirota/bandit && cd bandit
sh build.sh
```

`build.sh` compiles him, bundles the app, and installs a login-item that starts
him at boot and relaunches him if he ever crashes.

- **Stop him:** `launchctl bootout gui/$(id -u)/app.deskpet`
- **Uninstall:** `rm -rf ~/Applications/Bandit.app ~/Library/LaunchAgents/app.deskpet.plist ~/.deskpet`

## Playing with him

- **Move your mouse** — his eyes track you.
- **Hover him** → the Feed / Water / Pet / Edit ring. Edit recolors his coat and grass.
- **Drag his body** to move him; drop him and it sticks.
- Want him to react to your dev work too? He watches `~/.deskpet/state` — write a
  word to it from any tool (`printf celebrate > ~/.deskpet/state`) and he'll
  respond (`idle`, `working`, `thinking`, `celebrate`, `alert`).

## Under the hood

Pure JavaScript + `<canvas>` (no framework, no image assets — Bandit is drawn
entirely in code), [Tauri](https://tauri.app) for a tiny transparent
always-on-top window, and a macOS sandbox profile for the network guarantee.
**Bandit is an original character** — hand-drawn from scratch, not based on any
existing mascot.

## Contributing

Bandit is a personal project I'm sharing because he's fun. **I'm not taking
issues or pull requests** and may not respond to them — but please, **fork him**
and make your own creature. That's the whole spirit of it. 🦝

## License

[MIT](LICENSE).
