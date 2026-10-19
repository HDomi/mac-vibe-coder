#!/bin/zsh
# Manual update: pull the latest main, reinstall deps, rebuild, relaunch the installed app.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Mac Vibe Coder"
cd "$ROOT"
export PATH="$ROOT/runtime/node/bin:$(/bin/zsh -lic 'echo -n "$PATH"' 2>/dev/null):$PATH"
unset ELECTRON_RUN_AS_NODE

echo "▸ git pull"
git pull --ff-only
echo "▸ npm install"
npm install --no-audit --no-fund
echo "▸ build"
npm run build
scripts/brand-electron.sh >/dev/null || true

if [ -d "/Applications/$APP_NAME.app" ]; then
  echo "▸ relaunch"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  sleep 1
  open "/Applications/$APP_NAME.app"
fi
echo "updated to $(git rev-parse --short HEAD)"
