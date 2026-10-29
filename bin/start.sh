#!/bin/zsh
# Launcher used by launchd and by hand.
# Prefers the installed bundle in /Applications (proper name, icon and TCC identity);
# falls back to the Electron runtime in node_modules when the app is not installed.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="/Applications/Vibrato.app"
if [ -f "$ROOT/runtime/install-location" ]; then APP="$(cat "$ROOT/runtime/install-location")"; fi
cd "$ROOT"
export PATH="$ROOT/runtime/node/bin:$(/bin/zsh -lic 'echo -n "$PATH"' 2>/dev/null):$PATH"
unset ELECTRON_RUN_AS_NODE
if [ ! -f dist/server/index.js ] || [ ! -f web/dist/index.html ]; then
  npm run build || { echo "Build failed. Run install.sh to repair the installation." >&2; exit 0; }
fi
if [ -d "$APP" ]; then
  exec "$APP/Contents/MacOS/Vibrato"
fi
exec ./node_modules/.bin/electron .
