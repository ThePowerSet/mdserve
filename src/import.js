'use strict';
/**
 * Backfill the viewer with conversations that ended before the hook existed.
 *
 * Safe to re-run: each transcript simply regenerates its own file, because the
 * extractor rebuilds from scratch rather than appending.
 */

const fs = require('fs');
const path = require('path');

const { extract, OK, DELETED } = require('./extract');
const { listTranscripts } = require('./transcripts');
const { sessionsDir } = require('./paths');

/**
 * @param {number|'all'} want  how many of the newest transcripts to import
 */
function runImport(want = 30, { dir = sessionsDir(), log = console.log } = {}) {
  const all = listTranscripts();
  if (all.length === 0) {
    log('no transcripts found');
    return { imported: 0, total: 0 };
  }

  const files = want === 'all' ? all : all.slice(0, want);

  let imported = 0;
  let skipped = 0;
  for (const file of files) {
    const { code, session } = extract(file, { dir });
    if (code === DELETED) {
      skipped++;
      continue;
    }
    if (code !== OK) continue;

    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, session + '.json'), 'utf8'));
    } catch {
      // Sidecar is best-effort; the conversation itself is already written.
    }
    log(`${String(meta.turns ?? 0).padStart(4)} turns  ${meta.title ?? ''}`);
    imported++;
  }

  log('');
  log(`imported ${imported} of ${files.length} transcripts into ${dir}`);
  if (skipped) log(`${skipped} left out: deleted from the viewer`);
  return { imported, skipped, total: files.length };
}

module.exports = { runImport };
