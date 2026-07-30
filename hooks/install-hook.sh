#!/usr/bin/env bash
# Wire Bandit's permission bubble into Claude Code.
# Adds a PreToolUse hook for the tools that change things (Bash / Write / Edit).
# Safe to run twice — it won't duplicate the entry. Needs jq.

set -euo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/deskpet-permission"
SETTINGS="$HOME/.claude/settings.json"

command -v jq >/dev/null 2>&1 || { echo "This needs jq:  brew install jq"; exit 1; }
chmod +x "$HOOK"
mkdir -p "$HOME/.claude"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

tmp="$(mktemp)"
jq --arg cmd "$HOOK" '
  .hooks.PreToolUse = ((.hooks.PreToolUse // [])
    | map(select((.hooks // []) | map(.command) | index($cmd) | not))
    + [{ matcher: "Bash|Write|Edit|MultiEdit|NotebookEdit",
         hooks: [{ type: "command", command: $cmd }] }])
' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"

echo "Bandit is wired into Claude Code."
echo "Start a new Claude Code session (or run /hooks) to load it."
echo "To remove it, delete the PreToolUse entry in $SETTINGS."
