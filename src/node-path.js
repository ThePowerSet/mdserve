'use strict';
/**
 * Which `node` to write into a service file or a hook command.
 *
 * `process.execPath` is resolved and version-specific — on Homebrew it points
 * inside the Cellar, so the next `brew upgrade node` silently breaks every
 * absolute path we ever wrote down. Prefer a stable symlink that resolves to
 * the very same binary, and fall back to execPath when there is not one.
 */

const fs = require('fs');

const CANDIDATES = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/node',
];

function stableNodePath(execPath = process.execPath) {
  let real;
  try {
    real = fs.realpathSync(execPath);
  } catch {
    return execPath;
  }

  for (const candidate of CANDIDATES) {
    try {
      // Same binary, stable name: use the name that survives an upgrade.
      if (fs.realpathSync(candidate) === real) return candidate;
    } catch {
      // Not installed there; try the next one.
    }
  }

  return execPath;
}

module.exports = { stableNodePath };
