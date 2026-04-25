#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1-}" ]; then
  echo "Usage: $0 <vault-plugin-dir>"
  echo "  e.g. $0 \"/path/to/vault/.obsidian/plugins/obsidian-autotagger\""
  exit 1
fi

TARGET="$1"

npm run build
cp main.js manifest.json styles.css "$TARGET"
echo "Deployed to $TARGET"
