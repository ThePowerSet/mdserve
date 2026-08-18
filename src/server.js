'use strict';
/**
 * mdserve — a tiny zero-dependency live markdown viewer.
 *
 * Watches a directory of per-session markdown files and pushes updates to open
 * browser tabs over SSE. Each Claude Code session writes its own file plus a
 * small .json sidecar holding its title; the page lists them in a menu.
 *
 * Binds to 127.0.0.1 only. These are your conversations: the loopback bind is
 * the whole of the access control, so do not make it configurable.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { sessionsDir, port: defaultPort, rootDir } = require('./paths');

const MAX_SESSIONS = Number(process.env.MDSERVE_MAX_SESSIONS) || 200;
const VENDOR = path.join(rootDir(), 'vendor');
const VIEWER = path.join(__dirname, 'viewer.html');

/* ------------------------------------------------------------------ *
 * Reading sessions
 * ------------------------------------------------------------------ */

// CSI/OSC escape sequences that leak in when a TTY-ish stream is captured.
const ANSI = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[@-Z\\-_]|\x1B\[[0-?]*[ -/]*[@-~]/g;

function clean(text) {
  return text
    .replace(ANSI, '')
    .split('\n')
    // A line rewritten in place with \r keeps only its final state.
    .map((line) => (line.includes('\r') ? line.slice(line.lastIndexOf('\r') + 1) : line))
    .join('\n');
}

function createServer(dir) {
  const DIR = dir;

  function listSessions() {
    let names;
    try {
      names = fs.readdirSync(DIR).filter((n) => n.endsWith('.md'));
    } catch {
      return [];
    }

    return names
      .map((name) => {
        const id = name.slice(0, -3);
        let updated = 0;
        try {
          updated = fs.statSync(path.join(DIR, name)).mtimeMs;
        } catch {
          return null;
        }

        let meta = {};
        try {
          meta = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
        } catch {
          // Sidecar is optional; fall back to the bare id.
        }

        return {
          id,
          updated,
          title: meta.title || id.slice(0, 8),
          cwd: meta.cwd || '',
          turns: meta.turns || 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.updated - a.updated)
      .slice(0, MAX_SESSIONS);
  }

  function readSession(id) {
    // Ids come from the URL: keep them to a single path segment.
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
    try {
      const file = path.join(DIR, id + '.md');
      return { content: clean(fs.readFileSync(file, 'utf8')), mtime: fs.statSync(file).mtimeMs };
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------- *
   * Watching
   * ---------------------------------------------------------------- */

  const clients = new Set();
  let revision = 0;
  // id -> mtime, so a touched-but-unchanged file does not wake every tab.
  const seen = new Map();

  function scan() {
    const changed = [];
    for (const s of listSessions()) {
      if (seen.get(s.id) !== s.updated) {
        seen.set(s.id, s.updated);
        changed.push(s.id);
      }
    }
    return changed;
  }

  function broadcast(changed) {
    revision++;
    const payload = `event: update\ndata: ${JSON.stringify({ rev: revision, changed })}\n\n`;
    for (const res of clients) res.write(payload);
  }

  let timer = null;
  function onChange() {
    clearTimeout(timer);
    // Coalesce the burst of writes a streaming producer generates.
    timer = setTimeout(() => {
      const changed = scan();
      if (changed.length) broadcast(changed);
    }, 80);
  }

  /* ---------------------------------------------------------------- *
   * Static assets
   * ---------------------------------------------------------------- */

  const TYPES = {
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
  };

  function serveVendor(pathname, res) {
    const rel = decodeURIComponent(pathname.slice('/vendor/'.length));
    const file = path.resolve(VENDOR, rel);

    // Never let a crafted URL climb out of vendor/.
    if (file !== VENDOR && !file.startsWith(VENDOR + path.sep)) return false;

    const type = TYPES[path.extname(file)];
    if (!type) return false;

    let body;
    try {
      body = fs.readFileSync(file);
    } catch {
      return false;
    }

    // Vendored assets are version-pinned, so they can be cached hard.
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' });
    res.end(body);
    return true;
  }

  /* ---------------------------------------------------------------- *
   * HTTP
   * ---------------------------------------------------------------- */

  const PAGE = fs.readFileSync(VIEWER, 'utf8');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(PAGE);
      return;
    }

    if (url.pathname.startsWith('/vendor/')) {
      if (serveVendor(url.pathname, res)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    if (url.pathname === '/api/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(listSessions()));
      return;
    }

    if (url.pathname === '/raw') {
      const session = readSession(url.searchParams.get('s') || '');
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('no such session');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Mtime': String(session.mtime),
      });
      res.end(session.content);
      return;
    }

    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: update\ndata: ${JSON.stringify({ rev: revision, changed: [] })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  return { server, listSessions, readSession, scan, onChange, watchDir: () => DIR };
}

/** Boot the watcher and listen. Used by the CLI; exported for tests. */
function start({ dir = sessionsDir(), port = defaultPort(), quiet = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });

  const app = createServer(dir);
  app.scan();

  try {
    fs.watch(dir, app.onChange);
  } catch (err) {
    console.error('directory watch failed, relying on polling:', err.message);
  }
  // Belt and braces: fs.watch misses some network/virtual filesystems.
  setInterval(app.onChange, 2000).unref?.();

  app.server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`port ${port} is already in use — mdserve is probably running already`);
      process.exit(1);
    }
    throw err;
  });

  app.server.listen(port, '127.0.0.1', () => {
    if (quiet) return;
    console.log(`mdserve → http://localhost:${port}`);
    console.log(`watching ${dir}`);
  });

  return app;
}

module.exports = { start, createServer, clean, MAX_SESSIONS };
