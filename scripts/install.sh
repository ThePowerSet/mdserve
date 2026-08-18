#!/bin/sh
# Convenience wrapper: everything real lives in the CLI, so there is only one
# implementation of "install" to keep correct.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)

command -v node >/dev/null 2>&1 || {
  echo "mdserve needs Node 18 or newer, and node is not on PATH." >&2
  exit 1
}

exec node "$root/bin/mdserve.js" install "$@"
