#!/bin/sh
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
exec node "$root/bin/mdserve.js" uninstall "$@"
