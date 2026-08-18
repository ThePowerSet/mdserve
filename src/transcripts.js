'use strict';
/**
 * Finding Claude Code's transcripts.
 *
 * These files are the source of truth and mdserve never writes to them.
 */

const fs = require('fs');
const path = require('path');

const { projectsDir } = require('./paths');

/** Every transcript on disk, newest first. */
function listTranscripts(dir = projectsDir()) {
  let projects;
  try {
    projects = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }

  const found = [];
  for (const project of projects) {
    const projectPath = path.join(dir, project.name);
    let names;
    try {
      names = fs.readdirSync(projectPath).filter((n) => n.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(projectPath, name);
      try {
        found.push({ file, mtime: fs.statSync(file).mtimeMs });
      } catch {
        // Vanished between readdir and stat; nothing to do about it.
      }
    }
  }

  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
}

/** The transcript touched most recently, or null. */
function newestTranscript(dir = projectsDir()) {
  return listTranscripts(dir)[0] || null;
}

module.exports = { listTranscripts, newestTranscript };
