#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "First install the LTS version of Node.js from https://nodejs.org/, then open Start.command again."
  read -r -p "Press Return to close. "
  exit 1
fi
node scripts/launch.mjs
result=$?
if [ "$result" -ne 0 ]; then read -r -p "Press Return to close. "; fi
exit "$result"
