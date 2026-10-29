#!/bin/zsh
# Vibrato installer.
#   ./install.sh            build and install "/Applications/Vibrato.app", then launch it
#   ./install.sh --no-launch
#   ./install.sh --login    also enable "open at login" (LaunchAgent)
#
# The app bundle in /Applications is the branded Electron runtime with a tiny
# launcher that loads this checkout, so `git pull` + rebuild (or the in-app
# updater) updates the installed app without reinstalling.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Vibrato"
APP_DIR="${VIBRATO_APP_DIR:-/Applications}"
APP="$APP_DIR/$APP_NAME.app"
if [ -z "${VIBRATO_APP_DIR:-}" ] && [ -f "$ROOT/runtime/install-location" ]; then APP="$(cat "$ROOT/runtime/install-location")"; APP_DIR="$(dirname "$APP")"; fi
LAUNCH=1
LOGIN=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-launch) LAUNCH=0 ;;
    --login) LOGIN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "macOS only."

# Pick up nvm / Homebrew paths even when run from a bare shell.
export PATH="$(/bin/zsh -lic 'echo -n "$PATH"' 2>/dev/null):$PATH"
unset ELECTRON_RUN_AS_NODE

step "Checking prerequisites"
command -v git >/dev/null || fail "git not found. Install Xcode Command Line Tools: xcode-select --install"

# Node: use the system one when it is 20+, otherwise download a standalone runtime into ./runtime
# so the app never depends on a user-installed Node. The app also falls back to Electron's own Node.
NODE_VERSION="v24.13.0"
RUNTIME="$ROOT/runtime/node"
if [ -x "$RUNTIME/bin/node" ]; then
  export PATH="$RUNTIME/bin:$PATH"
fi
need_node=1
if command -v node >/dev/null; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$NODE_MAJOR" -ge 20 ] && need_node=0
fi
if [ "$need_node" = "1" ]; then
  step "Downloading Node $NODE_VERSION runtime into runtime/"
  ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] && NARCH="arm64" || NARCH="x64"
  TARBALL="node-$NODE_VERSION-darwin-$NARCH.tar.gz"
  mkdir -p "$ROOT/runtime"
  curl -fL --progress-bar "https://nodejs.org/dist/$NODE_VERSION/$TARBALL" -o "$ROOT/runtime/$TARBALL" || fail "Could not download Node. Check your network."
  curl -fL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$ROOT/runtime/SHASUMS256.txt" || fail "Could not download Node checksums."
  (cd "$ROOT/runtime"; awk -v name="$TARBALL" '$2 == name { print }' SHASUMS256.txt > node-checksum.txt; [ -s node-checksum.txt ] && shasum -a 256 -c node-checksum.txt) || fail "Node checksum verification failed."
  NODE_STAGE="$(mktemp -d "$ROOT/runtime/node-install.XXXXXX")"
  tar -xzf "$ROOT/runtime/$TARBALL" -C "$NODE_STAGE" || fail "Could not extract Node runtime."
  [ ! -e "$RUNTIME" ] || mv "$RUNTIME" "$NODE_STAGE/previous"
  mv "$NODE_STAGE/node-$NODE_VERSION-darwin-$NARCH" "$RUNTIME" || { [ ! -d "$NODE_STAGE/previous" ] || mv "$NODE_STAGE/previous" "$RUNTIME"; fail "Could not install Node runtime."; }
  rm -rf "$NODE_STAGE"
  rm -f "$ROOT/runtime/$TARBALL"
  export PATH="$RUNTIME/bin:$PATH"
fi
command -v npm >/dev/null || fail "npm not found."
echo "node $(node -v) · npm $(npm -v) · git $(git --version | awk '{print $3}')"
command -v claude >/dev/null && echo "claude $(claude --version 2>/dev/null | awk '{print $1}')" || echo "claude: not installed (install later from Settings)"
command -v codex  >/dev/null && echo "codex $(codex --version 2>/dev/null | awk '{print $2}')"  || echo "codex: not installed (install later from Settings)"

cd "$ROOT"
node "$ROOT/scripts/stop-app.cjs" "$APP" "$ROOT"

if [ "$SKIP_BUILD" != 1 ]; then
step "Installing dependencies"
npm ci --no-audit --no-fund

step "Building"
npm run build
fi

step "Branding Electron runtime"
scripts/brand-electron.sh

step "Installing $APP"
SRC="$ROOT/node_modules/electron/dist/Electron.app"
[ -d "$SRC" ] || fail "Electron runtime missing at $SRC"
mkdir -p "$APP_DIR"
APP_STAGE="$(mktemp -d "$APP_DIR/.vibrato-install.XXXXXX")"
cleanup_bundle() {
  local result=$?
  trap - EXIT
  if [ ! -d "$APP" ] && [ -d "$APP_STAGE/previous.app" ]; then mv "$APP_STAGE/previous.app" "$APP"; fi
  rm -rf "$APP_STAGE"
  exit "$result"
}
trap cleanup_bundle EXIT
node "$ROOT/scripts/create-app.cjs" "$SRC" "$APP_STAGE/$APP_NAME.app" "$ROOT"
node "$ROOT/scripts/stop-app.cjs" "$APP" "$ROOT"
if [ -d "$APP" ]; then mv "$APP" "$APP_STAGE/previous.app"; fi
mv "$APP_STAGE/$APP_NAME.app" "$APP"
mkdir -p "$ROOT/runtime"
printf '%s\n' "$APP" > "$ROOT/runtime/install-location"
touch "$APP"
# Let Launch Services notice the new bundle id / name.
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
echo "installed: $APP"
echo "code:      $ROOT (git pull + npm run build updates the app)"

if [ "$LOGIN" = "1" ]; then
  step "Enabling open at login"
  scripts/launchd.sh install
fi

if [ "$LAUNCH" = "1" ]; then
  step "Launching"
  open "$APP"
fi

printf '\n'
bold "Done. Vibrato is in $APP_DIR (Launchpad · Spotlight · Dock)."
echo "First run may ask for access to Desktop/Documents — allow it so the file browser can see those folders."
echo "Update later: open the app and click the Update badge, or run scripts/update.sh"
echo "Uninstall:    scripts/uninstall.sh"
