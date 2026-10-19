#!/bin/zsh
# Remove the installed app and login item. Keeps this checkout.
#   scripts/uninstall.sh          remove app + LaunchAgent
#   scripts/uninstall.sh --purge  also delete ~/.mac-vibe-coder (favorites, attachments)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Mac Vibe Coder"
APP="/Applications/$APP_NAME.app"

osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
"$ROOT/scripts/launchd.sh" uninstall >/dev/null 2>&1 || true
if [ -d "$APP" ]; then rm -rf "$APP"; echo "removed $APP"; else echo "app not installed"; fi
if [ "$1" = "--purge" ]; then rm -rf "$HOME/.mac-vibe-coder"; echo "removed ~/.mac-vibe-coder"; fi
echo "done. The source checkout at $ROOT was left in place."
