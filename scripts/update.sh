#!/bin/zsh
# Manual update: pull the latest main, reinstall deps, rebuild, relaunch the installed app.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Mac Vibe Coder"
cd "$ROOT"
export PATH="$ROOT/runtime/node/bin:$(/bin/zsh -lic 'echo -n "$PATH"' 2>/dev/null):$PATH"
unset ELECTRON_RUN_AS_NODE

APP="${MVC_APP_DIR:-/Applications}/$APP_NAME.app"
if [ -f "$ROOT/runtime/install-location" ]; then APP="$(cat "$ROOT/runtime/install-location")"; fi
# Stop before changing Electron or any lazy-loaded dependency.
node "$ROOT/scripts/stop-app.cjs" "$APP" "$ROOT"
unset MVC_ELECTRON_EXEC_PATH MVC_ELECTRON_VERSION
/bin/zsh "$ROOT/scripts/apply-update.sh"
if [ -d "$APP" ]; then
  MVC_APP_DIR="$(dirname "$APP")" /bin/zsh "$ROOT/install.sh" --skip-build
fi
echo "updated to $(git rev-parse --short HEAD)"
