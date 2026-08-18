'use strict';
/**
 * Registering the Stop hook in Claude Code's user settings.
 *
 * This file edits a configuration file the user did not write for us, so it is
 * deliberately conservative: it backs up before writing, it is idempotent, and
 * on removal it only ever touches entries it can positively identify as its
 * own. Anything it does not recognise is left exactly as found.
 */

const fs = require('fs');
const path = require('path');

const { settingsFile, rootDir } = require('./paths');

/** The substring that identifies a hook entry as installed by this repo. */
const MARKER = path.join('bin', 'mdserve.js');

/** Absolute paths, and the interpreter we are running under: no PATH guessing. */
function hookCommand(root = rootDir()) {
  return `"${process.execPath}" "${path.join(root, 'bin', 'mdserve.js')}" hook`;
}

function isOurs(entry) {
  return typeof entry?.command === 'string' && entry.command.includes(MARKER);
}

function readSettings(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings.json is not a JSON object');
    }
    return { settings: parsed, existed: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { settings: {}, existed: false };
    throw err;
  }
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${file}.mdserve-backup-${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function write(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

/** Add the Stop hook, unless an equivalent one is already registered. */
function installHook({ file = settingsFile(), root = rootDir() } = {}) {
  const { settings } = readSettings(file);
  const command = hookCommand(root);

  const hooks = (settings.hooks ||= {});
  const stop = (hooks.Stop ||= []);

  const already = stop.some((group) => (group?.hooks || []).some(isOurs));
  if (already) return { changed: false, command, backup: null };

  const saved = backup(file);
  stop.push({ hooks: [{ type: 'command', command, async: true, timeout: 15 }] });
  write(file, settings);

  return { changed: true, command, backup: saved };
}

/** Remove only the entries this repo installed, then prune what is left empty. */
function uninstallHook({ file = settingsFile() } = {}) {
  const { settings, existed } = readSettings(file);
  if (!existed) return { changed: false, backup: null };

  const stop = settings?.hooks?.Stop;
  if (!Array.isArray(stop)) return { changed: false, backup: null };

  let removed = 0;
  const kept = [];
  for (const group of stop) {
    const entries = group?.hooks;
    if (!Array.isArray(entries)) {
      kept.push(group);
      continue;
    }
    const survivors = entries.filter((e) => !isOurs(e));
    removed += entries.length - survivors.length;
    // A group that only ever held our hook goes with it; one that held other
    // hooks too keeps them, and its own extra keys.
    if (survivors.length > 0) kept.push({ ...group, hooks: survivors });
    else if (entries.length === 0) kept.push(group);
  }

  if (removed === 0) return { changed: false, backup: null };

  const saved = backup(file);
  if (kept.length > 0) settings.hooks.Stop = kept;
  else delete settings.hooks.Stop;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  write(file, settings);

  return { changed: true, removed, backup: saved };
}

module.exports = { installHook, uninstallHook, hookCommand, isOurs, MARKER };
