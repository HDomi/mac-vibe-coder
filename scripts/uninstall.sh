#!/bin/zsh
# Remove the installed app and login item. Keeps this checkout.
#   scripts/uninstall.sh          remove app + LaunchAgent
#   scripts/uninstall.sh --purge  also delete ~/.vibrato (favorites, attachments)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Vibrato"
APP="${VIBRATO_APP_DIR:-/Applications}/$APP_NAME.app"
if [ -f "$ROOT/runtime/install-location" ]; then APP="$(cat "$ROOT/runtime/install-location")"; fi
export PATH="$ROOT/runtime/node/bin:$(/bin/zsh -lic 'echo -n "$PATH"' 2>/dev/null):$PATH"

node "$ROOT/scripts/stop-app.cjs" "$APP" "$ROOT"
"$ROOT/scripts/launchd.sh" uninstall >/dev/null 2>&1 || true
if [ -d "$APP" ]; then rm -rf "$APP"; echo "removed $APP"; else echo "app not installed"; fi
if [ "$1" = "--purge" ]; then rm -rf "$HOME/.vibrato"; echo "removed ~/.vibrato"; fi
echo "done. The source checkout at $ROOT was left in place."
