'use strict';
/**
 * Shared locations and environment overrides.
 *
 * Every path mdserve touches is resolved here, so a packager or a user with an
 * unusual layout has exactly one file to look at.
 */

const os = require('os');
const path = require('path');

const home = os.homedir();

/** Where Claude Code keeps the transcripts. Read-only, for us. */
const projectsDir = () =>
  path.resolve(process.env.CLAUDE_PROJECTS_DIR || path.join(home, '.claude', 'projects'));

/** Where the rendered conversations go. */
const sessionsDir = () =>
  path.resolve(process.env.MDSERVE_DIR || path.join(home, '.mdserve', 'sessions'));

/** The state directory that holds the sessions dir and the server log. */
const stateDir = () => path.dirname(sessionsDir());

const logFile = () => path.join(stateDir(), 'mdserve.log');

const port = () => Number(process.env.MDSERVE_PORT) || 4577;

/** Claude Code's user settings, where the Stop hook is registered. */
const settingsFile = () =>
  path.resolve(process.env.CLAUDE_SETTINGS || path.join(home, '.claude', 'settings.json'));

/** Repo root, resolved from this file rather than from the caller's cwd. */
const rootDir = () => path.resolve(__dirname, '..');

module.exports = { home, projectsDir, sessionsDir, stateDir, logFile, port, settingsFile, rootDir };
