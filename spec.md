# deskpet — design spec

A private, in-house desktop creature for macOS, inspired by Clawd, built so **no
third party ever sees your work**. The creature lives above the Dock and reacts
to a coding agent activity in real time: it perks up when you send a prompt, works
while tools run, jumps when a turn finishes, and dozes off when left alone.

## Why in-house

The whole point is confidentiality. Community desktop pets install hooks that
read your a coding agent sessions; this one is yours end to end. It is built so it
*cannot* leak:

- **No network, enforced twice.** The webview CSP sets `connect-src 'none'`, and
  the Rust binary contains no http/socket crate. There is no code path off the
  machine.
- **No npm / no build-time JS deps.** The frontend is plain HTML/CSS/JS — nothing
  to audit in `node_modules` because there is none.
- **Tiny Rust surface.** `tauri` + `serde` only, pinned in `Cargo.lock`; one
  `cargo audit` covers it.
- **Scoped capabilities.** The webview may only listen for events, start-drag,
  and set its own position. No fs, shell, http, or dialog access.

## Architecture

Three small pieces, each with one job:

1. **The window** (`src-tauri/`) — a transparent, borderless, always-on-top Tauri
   window parked bottom-center. Renders only the creature; the rest is
   see-through. Positions itself above the Dock on launch.
2. **The creature** (`src/pet.js`) — a hand-drawn canvas character with a mood
   state machine. No image assets. Retint via the `T` theme object.
3. **The bridge** (`hooks/`) — a coding agent hooks echo a mood word into
   `~/.deskpet/state`. A Rust thread polls that file and emits a `mood` event to
   the webview.

## Data flow

```
a coding agent event → hook command → ~/.deskpet/state (one word)
   → Rust polls file (350 ms) → emits "mood" event → pet.js state machine → animation
```

One direction, one local file. Nothing else is read or written.

## Moods

| a coding agent hook           | state       | animation                         |
| -------------------------- | ----------- | --------------------------------- |
| `UserPromptSubmit`         | `thinking`  | looks up, thought bubble rises    |
| `PreToolUse` / `PostToolUse` | `working`  | busy shuffle, focused eyes        |
| `Stop` (turn finishes)     | `celebrate` | jumps, happy eyes, sparkles       |
| `Notification` (needs you) | `alert`     | faces you, waves, bouncing "!"    |
| no activity for 3 min      | `sleep`     | eyes closed, floating "z"         |
| default                    | `idle`      | breathing, occasional blink       |

`celebrate` and `alert` are transient (auto-return to idle). `sleep` is entered
client-side after an idle timeout and cleared by any new event.

## v1 scope (YAGNI)

In: the six moods, drag-to-reposition, launch-at-login, the lockdown posture
above. Out (later, if wanted): chat / AI brain, sound, position persistence,
custom themes, multiple characters.

## Layout

```
deskpet/
  src/                 frontend (index.html, styles.css, pet.js)
  src-tauri/           Rust shell (main.rs, tauri.conf.json, capabilities/)
    icons/make-icon.py stdlib PNG generator for the app icon
  hooks/               deskpet-state, install-hooks.js, settings snippet
  install.sh           one-shot setup
```
