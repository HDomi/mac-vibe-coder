#!/bin/zsh
# Fail when package-lock.json would break `npm ci` (install.sh, apply-update.sh) or disagrees
# with package.json's version. Checks the staged files with --staged (used by the pre-commit hook).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ "$1" = "--staged" ]; then
  git -C "$ROOT" show :package.json > "$TMP/package.json"
  git -C "$ROOT" show :package-lock.json > "$TMP/package-lock.json"
else
  cp "$ROOT/package.json" "$ROOT/package-lock.json" "$TMP/"
fi
cd "$TMP"
node -e '
  const pkg = require("./package.json"), lock = require("./package-lock.json");
  const bad = [["package-lock.json version", lock.version], ["package-lock.json packages[\"\"].version", lock.packages?.[""]?.version]]
    .filter(([, v]) => v !== pkg.version);
  for (const [k, v] of bad) console.error(`${k} is ${v}, package.json is ${pkg.version}`);
  if (bad.length) { console.error("Run: npm install --package-lock-only"); process.exit(1); }
'
# A dry run in a scratch copy validates the lock against package.json without touching node_modules.
if ! npm ci --dry-run --ignore-scripts --no-audit --no-fund > "$TMP/ci.log" 2>&1; then
  grep -m5 'npm error' "$TMP/ci.log" >&2 || cat "$TMP/ci.log" >&2
  echo 'package-lock.json is out of sync with package.json. Run: npm install --package-lock-only' >&2
  exit 1
fi
echo 'lock ok'
