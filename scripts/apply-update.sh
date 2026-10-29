#!/bin/zsh
# Build off to the side; restore every artifact directory if a replacement or fast-forward fails.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$ROOT/runtime/node/bin:$PATH"
command -v npm >/dev/null || { echo 'Node.js 20+ and npm are required. Run install.sh first.' >&2; exit 1; }
[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ] || { echo 'Node.js 20+ required.' >&2; exit 1; }
BRANCH="$(git symbolic-ref --quiet --short HEAD)" || { echo 'Updates require a branch checkout, not detached HEAD.' >&2; exit 1; }
REMOTE="$(git remote get-url origin)"
mkdir -p runtime
STAGE="$(mktemp -d "$ROOT/runtime/update.XXXXXX")"
DONE=0
NODE_SWAP=0
DIST_SWAP=0
WEB_SWAP=0
restore() {
  local flag="$1" target="$2" backup="$3"
  if [ "$flag" = 1 ]; then
    rm -rf "$target"
    if [ -d "$backup" ]; then mv "$backup" "$target"; fi
  fi
}
cleanup() {
  local result=$?
  trap - EXIT
  if [ "$DONE" != 1 ]; then
    restore "$WEB_SWAP" "$ROOT/web/dist" "$STAGE/old-web"
    restore "$DIST_SWAP" "$ROOT/dist" "$STAGE/old-dist"
    restore "$NODE_SWAP" "$ROOT/node_modules" "$STAGE/old-node"
  fi
  rm -rf "$STAGE"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo "▸ clone $BRANCH into staging directory"
git clone --quiet --branch "$BRANCH" -- "$REMOTE" "$STAGE/src"
SHA="$(git -C "$STAGE/src" rev-parse HEAD)"
CURRENT="$(git rev-parse HEAD)"
# Validate against the cloned commit, not a second network fetch that could select a newer build.
git -C "$STAGE/src" merge-base --is-ancestor "$CURRENT" "$SHA" || { echo 'Checkout cannot fast-forward to the selected update.' >&2; exit 1; }
cd "$STAGE/src"
echo '▸ npm ci (staging)'
npm ci --no-audit --no-fund
echo '▸ build (staging)'
npm run build
if [ -n "${VIBRATO_ELECTRON_VERSION:-}" ] && [ "$VIBRATO_ELECTRON_VERSION" != "$(node -p 'require("./node_modules/electron/package.json").version')" ]; then
  echo 'Electron runtime changed. Run scripts/update.sh to reinstall the app bundle safely.' >&2
  exit 1
fi
if [ -n "${VIBRATO_ELECTRON_EXEC_PATH:-}" ] && [[ "$VIBRATO_ELECTRON_EXEC_PATH" = "$ROOT/node_modules/"* ]]; then
  echo 'Run scripts/update.sh to update an app launched from node_modules.' >&2
  exit 1
fi
cd "$ROOT"
echo '▸ replace artifacts (rollback on failure)'
if [ -d node_modules ]; then mv node_modules "$STAGE/old-node"; fi
NODE_SWAP=1
mv "$STAGE/src/node_modules" node_modules
if [ -d dist ]; then mv dist "$STAGE/old-dist"; fi
DIST_SWAP=1
mv "$STAGE/src/dist" dist
mkdir -p web
if [ -d web/dist ]; then mv web/dist "$STAGE/old-web"; fi
WEB_SWAP=1
mv "$STAGE/src/web/dist" web/dist
echo '▸ fast-forward checkout to the built commit'
git fetch --quiet "$STAGE/src" "$SHA"
git merge --ff-only "$SHA"
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo 'Checkout changed during update.' >&2; exit 1; }
DONE=1
echo "▸ updated to $(git rev-parse --short HEAD)"
