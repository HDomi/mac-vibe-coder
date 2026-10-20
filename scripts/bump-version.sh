#!/bin/zsh
# Bump the version in package.json and package-lock.json together, then verify the lock.
# Usage: scripts/bump-version.sh [patch|minor|major|<version>]  (default: patch)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm version "${1:-patch}" --no-git-tag-version > /dev/null
scripts/check-lock.sh
node -p 'require("./package.json").version'
