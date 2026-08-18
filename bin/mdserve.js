#!/usr/bin/env node
'use strict';
/**
 * mdserve — read your Claude Code conversations in a browser.
 *
 * One entry point for every part of the tool, so there is a single thing to
 * put on PATH and a single path to write into settings.json.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

const { sessionsDir, port: defaultPort, logFile, settingsFile, rootDir } = require('../src/paths');

const USAGE = `mdserve — read your Claude Code conversations in a browser

usage: mdserve <command> [options]

commands:
  serve [dir]            run the viewer (foreground) on http://localhost:${defaultPort()}
  import [n|all]         render past conversations (default: 30 newest)
  extract <transcript>   re-render one conversation from its .jsonl
  hook                   Stop-hook entry point; reads its payload on stdin
  install [--no-service] register the Stop hook, and start at login
  uninstall              undo install; leaves rendered conversations in place
  status                 what is running, and where
  help, version

environment:
  MDSERVE_PORT           port to listen on            (default 4577)
  MDSERVE_DIR            where conversations are kept (default ~/.mdserve/sessions)
  MDSERVE_MAX_SESSIONS   sessions listed in the menu  (default 200)
  CLAUDE_PROJECTS_DIR    where transcripts are read   (default ~/.claude/projects)
`;

const has = (argv, flag) => argv.includes(flag);

/** Is the viewer already answering on its port? */
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

function cmdServe(argv) {
  const { start } = require('../src/server');
  start({ dir: argv[0] ? path.resolve(argv[0]) : sessionsDir(), port: defaultPort() });
}

function cmdImport(argv) {
  const { runImport } = require('../src/import');
  const arg = argv[0] ?? '30';

  if (arg !== 'all' && !/^\d+$/.test(arg)) {
    console.error('usage: mdserve import [n|all]');
    process.exit(2);
  }

  const { imported } = runImport(arg === 'all' ? 'all' : Number(arg));
  process.exit(imported > 0 ? 0 : 1);
}

function cmdExtract(argv) {
  const { extract, OK, UNCHANGED } = require('../src/extract');
  const target = argv[0];

  if (!target) {
    console.error('usage: mdserve extract <transcript.jsonl>');
    process.exit(2);
  }

  const { code, session } = extract(path.resolve(target), { dir: sessionsDir() });
  if (code === OK) console.log(session);
  else if (code === UNCHANGED) console.error('unchanged');
  else if (code === 2) console.error('not a readable transcript');
  else console.error('nothing to render in that transcript');
  process.exit(code);
}

async function cmdHook() {
  const { run } = require('../src/hook');
  try {
    await run();
  } catch {
    // A viewer problem must never surface inside the session it is watching.
  }
  process.exit(0);
}

function cmdInstall(argv) {
  const { installHook } = require('../src/settings');
  const service = require('../src/service');

  const hook = installHook();
  console.log(
    hook.changed
      ? `Stop hook registered in ${settingsFile()}`
      : `Stop hook already registered in ${settingsFile()}`
  );
  if (hook.backup) console.log(`  previous settings saved to ${hook.backup}`);

  if (!has(argv, '--no-service')) service.install({ root: rootDir(), port: defaultPort() });
  else console.log('skipping login service (--no-service)');

  console.log('');
  console.log(`Done. Open http://localhost:${defaultPort()}`);
  console.log('Backfill past conversations with:  mdserve import all');
}

function cmdUninstall() {
  const { uninstallHook } = require('../src/settings');
  const service = require('../src/service');

  service.uninstall();

  const hook = uninstallHook();
  console.log(hook.changed ? 'Stop hook removed from settings.json' : 'no Stop hook of ours to remove');
  if (hook.backup) console.log(`  previous settings saved to ${hook.backup}`);

  console.log('');
  console.log(`Rendered conversations were left in ${sessionsDir()}`);
  console.log('Remove them by hand if you want them gone.');
}

async function cmdStatus() {
  const service = require('../src/service');
  const { isOurs } = require('../src/settings');

  const port = defaultPort();
  const dir = sessionsDir();

  let hooked = false;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    hooked = (settings?.hooks?.Stop || []).some((g) => (g?.hooks || []).some(isOurs));
  } catch {
    // No settings file, or not ours to read: reported as "no" below.
  }

  let sessions = 0;
  try {
    sessions = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).length;
  } catch {
    // Not rendered anything yet.
  }

  console.log(`server      ${(await isListening(port)) ? `listening on http://localhost:${port}` : 'not running'}`);
  console.log(`service     ${service.status()}`);
  console.log(`stop hook   ${hooked ? 'registered' : 'not registered'}`);
  console.log(`sessions    ${sessions} in ${dir}`);
  console.log(`log         ${logFile()}`);
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);

  switch (command) {
    case 'serve':      return cmdServe(argv);
    case 'import':     return cmdImport(argv);
    case 'extract':    return cmdExtract(argv);
    case 'hook':       return cmdHook();
    case 'install':    return cmdInstall(argv);
    case 'uninstall':  return cmdUninstall();
    case 'status':     return cmdStatus();
    case 'version':
    case '--version':  return console.log(require('../package.json').version);
    case 'help':
    case '--help':
    case '-h':
    case undefined:    return console.log(USAGE);
    default:
      console.error(`unknown command: ${command}\n`);
      console.error(USAGE);
      process.exit(2);
  }
}

main();
