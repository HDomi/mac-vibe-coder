#!/bin/zsh
# Launcher used by launchd and by hand. Starts the Electron app from this checkout.
# Pins PATH from the login shell so nvm/Homebrew binaries (node, claude, codex) are visible.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$(/bin/zsh -lic 'echo -n "$PATH"' 2>/dev/null):$PATH"
unset ELECTRON_RUN_AS_NODE
if [ ! -f dist/server/index.js ] || [ ! -f web/dist/index.html ]; then
  npm run build
fi
exec ./node_modules/.bin/electron .
