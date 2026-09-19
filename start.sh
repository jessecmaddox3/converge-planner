#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "First install Node.js 22 or newer from https://nodejs.org/."
  exit 1
fi
exec node scripts/launch.mjs
