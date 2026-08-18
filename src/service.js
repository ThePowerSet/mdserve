'use strict';
/**
 * Keeping the viewer running across logins.
 *
 * Optional. The Stop hook already starts the server when it finds the port
 * quiet, so a service only buys you a viewer that is up before you have asked
 * anything. macOS gets a launchd agent, Linux a systemd user unit; anywhere
 * else, run `mdserve serve` yourself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { home, logFile, stateDir, rootDir, port: defaultPort } = require('./paths');
const { stableNodePath } = require('./node-path');

/** Fork this and you should change it to a domain you actually control. */
const LABEL = 'io.github.mdserve';

const platform = () => process.platform;

const plistPath = () => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const unitPath = () => path.join(home, '.config', 'systemd', 'user', 'mdserve.service');

const serviceFile = () =>
  platform() === 'darwin' ? plistPath() : platform() === 'linux' ? unitPath() : null;

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist(root, port) {
  const log = logFile();
  // Give launchd node's own directory: a login agent does not inherit the
  // interactive shell's PATH, which is how these installs usually break.
  const PATH = `${path.dirname(stableNodePath())}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(stableNodePath())}</string>
    <string>${escapeXml(path.join(root, 'bin', 'mdserve.js'))}</string>
    <string>serve</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <!-- Bring it back if it ever exits, but back off so a broken install does
       not spin. -->
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>WorkingDirectory</key>
  <string>${escapeXml(root)}</string>

  <!-- /tmp is wiped on reboot, which is how the last log went missing. -->
  <key>StandardOutPath</key>
  <string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(log)}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(PATH)}</string>
    <key>MDSERVE_PORT</key>
    <string>${port}</string>
  </dict>
</dict>
</plist>
`;
}

function unit(root, port) {
  return `[Unit]
Description=mdserve — Claude Code conversation viewer
After=default.target

[Service]
Type=simple
WorkingDirectory=${root}
Environment=MDSERVE_PORT=${port}
ExecStart=${stableNodePath()} ${path.join(root, 'bin', 'mdserve.js')} serve
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

const uid = () => (typeof process.getuid === 'function' ? process.getuid() : 0);
const domain = () => `gui/${uid()}`;

function run(cmd, args, { check = false } = {}) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (err) {
    if (check) throw err;
    return { ok: false, out: (err.stderr || err.stdout || String(err.message)).trim() };
  }
}

function install({ root = rootDir(), port = defaultPort(), log = console.log } = {}) {
  fs.mkdirSync(stateDir(), { recursive: true });
  const file = serviceFile();

  if (!file) {
    log(`no service integration for ${platform()}; run "mdserve serve" yourself`);
    return { installed: false };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (platform() === 'darwin') {
    fs.writeFileSync(file, plist(root, port));
    // Replace any previous incarnation rather than stacking on top of it.
    run('launchctl', ['bootout', `${domain()}/${LABEL}`]);
    const res = run('launchctl', ['bootstrap', domain(), file]);
    if (!res.ok) {
      log(`launchctl bootstrap failed: ${res.out}`);
      return { installed: false, file };
    }
  } else {
    fs.writeFileSync(file, unit(root, port));
    run('systemctl', ['--user', 'daemon-reload']);
    const res = run('systemctl', ['--user', 'enable', '--now', 'mdserve.service']);
    if (!res.ok) {
      log(`systemctl enable failed: ${res.out}`);
      return { installed: false, file };
    }
  }

  log(`service installed: ${file}`);
  return { installed: true, file };
}

function uninstall({ log = console.log } = {}) {
  const file = serviceFile();
  if (!file) return { removed: false };

  if (platform() === 'darwin') {
    run('launchctl', ['bootout', `${domain()}/${LABEL}`]);
  } else {
    run('systemctl', ['--user', 'disable', '--now', 'mdserve.service']);
    run('systemctl', ['--user', 'daemon-reload']);
  }

  const existed = fs.existsSync(file);
  if (existed) fs.rmSync(file, { force: true });
  log(existed ? `service removed: ${file}` : 'no service file to remove');
  return { removed: existed, file };
}

function status() {
  const file = serviceFile();
  if (!file || !fs.existsSync(file)) return 'not installed';

  if (platform() === 'darwin') {
    const res = run('launchctl', ['print', `${domain()}/${LABEL}`]);
    if (!res.ok) return 'installed, not loaded';
    const state = /state = (\w+)/.exec(res.out);
    const pid = /pid = (\d+)/.exec(res.out);
    return `${state ? state[1] : 'loaded'}${pid ? ` (pid ${pid[1]})` : ''}`;
  }

  const res = run('systemctl', ['--user', 'is-active', 'mdserve.service']);
  return res.out.trim() || 'unknown';
}

module.exports = { install, uninstall, status, serviceFile, LABEL };
