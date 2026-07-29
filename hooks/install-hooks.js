#!/usr/bin/env node
// Safely merge deskpet's Claude Code hooks into ~/.claude/settings.json.
//   - backs up the existing file first
//   - APPENDS our hook entries (never clobbers your existing hooks)
//   - dedupes, so running it twice is a no-op
//   - writes absolute paths so it works regardless of shell ~ expansion
//
// Run:  node hooks/install-hooks.js
// Undo: node hooks/install-hooks.js --remove
const fs = require("fs");
const path = require("path");
const os = require("os");

const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const SCRIPT = path.join(__dirname, "deskpet-state");
const remove = process.argv.includes("--remove");

const MAP = {
  UserPromptSubmit: "thinking",
  PreToolUse: "working",
  PostToolUse: "working",
  Stop: "celebrate",
  Notification: "alert",
};
const NEEDS_MATCHER = new Set(["PreToolUse", "PostToolUse"]);
const cmd = (mood) => `${SCRIPT} ${mood}`;
const isOurs = (c) => typeof c === "string" && c.startsWith(SCRIPT);

function load() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch {
    return {};
  }
}

function save(obj) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(obj, null, 2) + "\n");
}

function backup() {
  if (!fs.existsSync(SETTINGS)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dst = `${SETTINGS}.bak-${stamp}`;
  fs.copyFileSync(SETTINGS, dst);
  return dst;
}

function stripOurs(settings) {
  const h = settings.hooks || {};
  for (const event of Object.keys(h)) {
    h[event] = (h[event] || [])
      .map((entry) => ({
        ...entry,
        hooks: (entry.hooks || []).filter((x) => !isOurs(x.command)),
      }))
      .filter((entry) => (entry.hooks || []).length > 0);
    if (h[event].length === 0) delete h[event];
  }
  return settings;
}

const settings = load();
const bak = backup();
stripOurs(settings); // clean any prior install first (idempotent)

if (!remove) {
  settings.hooks = settings.hooks || {};
  for (const [event, mood] of Object.entries(MAP)) {
    const entry = { hooks: [{ type: "command", command: cmd(mood) }] };
    if (NEEDS_MATCHER.has(event)) entry.matcher = "*";
    settings.hooks[event] = settings.hooks[event] || [];
    settings.hooks[event].push(entry);
  }
}

save(settings);
console.log(remove ? "deskpet hooks removed." : "deskpet hooks installed.");
if (bak) console.log("backup:", bak);
console.log("settings:", SETTINGS);
