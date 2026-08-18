'use strict';
/**
 * Stop hook: refresh this session's conversation in the browser.
 *
 * Reads the hook payload on stdin, works out which transcript it belongs to,
 * and hands it to the extractor, which rewrites the whole conversation. Each
 * session gets its own file, so several Claude Code windows can be read side
 * by side.
 *
 * This must never fail loudly: a broken viewer is not a reason to disturb the
 * session it is watching, so every path here ends in exit 0.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const { extract, OK } = require('./extract');
const { newestTranscript } = require('./transcripts');
const { sessionsDir, port: defaultPort, logFile, stateDir, rootDir } = require('./paths');

const ATTEMPTS = 15;
const INTERVAL_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

/** Is something already listening on the viewer's port? */
function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(500);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

/** Bring the viewer up, detached, so it outlives this hook process. */
function startServer() {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    const log = fs.openSync(logFile(), 'a');
    const child = spawn(process.execPath, [path.join(rootDir(), 'bin', 'mdserve.js'), 'serve'], {
      detached: true,
      stdio: ['ignore', log, log],
    });
    child.unref();
  } catch {
    // If it will not start here it will start at the next login; not fatal.
  }
}

async function run() {
  const payload = await readStdin();

  let transcript = '';
  try {
    transcript = JSON.parse(payload).transcript_path || '';
  } catch {
    // Older payloads may not be JSON at all.
  }

  // Older payloads may not carry the path; fall back to the newest transcript.
  if (!transcript || !fs.existsSync(transcript)) transcript = newestTranscript() || '';
  if (!transcript) return;

  // The turn's final message is often still unflushed when Stop fires, so poll
  // until the transcript actually shows something new — extract reports
  // UNCHANGED while the rebuilt conversation is identical to the file on disk.
  // This hook runs async, so waiting a few seconds costs the session nothing.
  for (let i = 0; i < ATTEMPTS; i++) {
    let code;
    try {
      code = extract(transcript, { dir: sessionsDir(), requireChange: true }).code;
    } catch {
      break;
    }
    if (code === OK) break;
    await sleep(INTERVAL_MS);
  }

  const port = defaultPort();
  if (!(await isListening(port))) startServer();
}

module.exports = { run };
