'use strict';
/**
 * The server is small, but it exposes a filesystem over HTTP, so the tests
 * that matter are the ones about what it refuses to serve.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer, clean } = require('../src/server');

function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdserve-http-'));
  fs.writeFileSync(path.join(dir, 'abc123.md'), '<!--mdsv u 2026-01-01T00:00:00Z-->\n\nhello\n');
  fs.writeFileSync(path.join(dir, 'abc123.json'), JSON.stringify({ title: 'Demo', cwd: '/x', turns: 1 }));

  const { server } = createServer(dir);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        await fn(base, dir);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test('lists sessions with their sidecar metadata', async () => {
  await withServer(async (base) => {
    const sessions = await (await fetch(`${base}/api/sessions`)).json();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'abc123');
    assert.equal(sessions[0].title, 'Demo');
    assert.equal(sessions[0].turns, 1);
  });
});

test('serves a conversation, and 404s an unknown one', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/raw?s=abc123`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('hello'));

    assert.equal((await fetch(`${base}/raw?s=nope`)).status, 404);
  });
});

test('a session id cannot escape the sessions directory', async () => {
  await withServer(async (base) => {
    for (const id of ['../../etc/passwd', '..%2F..%2Fetc%2Fpasswd', 'a/b']) {
      const res = await fetch(`${base}/raw?s=${id}`);
      assert.equal(res.status, 404, `${id} must not resolve`);
    }
  });
});

test('serves vendored assets but nothing above them', async () => {
  await withServer(async (base) => {
    const ok = await fetch(`${base}/vendor/marked.min.js`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /javascript/);

    // Traversal, and file types we never intend to expose.
    assert.equal((await fetch(`${base}/vendor/..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/vendor/nope.js`)).status, 404);
  });
});

test('the page itself loads with no external requests', async () => {
  await withServer(async (base) => {
    const html = await (await fetch(base)).text();
    assert.ok(html.includes('/vendor/marked.min.js'));
    const remote = html.replace(/https?:\/\/(localhost|127\.0\.0\.1)/g, '');
    assert.ok(!/https?:\/\//.test(remote), 'the viewer must not reach out to any network host');
  });
});

test('strips terminal escapes and carriage-return rewrites', () => {
  assert.equal(clean('\x1B[31mred\x1B[0m'), 'red');
  assert.equal(clean('progress 10%\rprogress 100%'), 'progress 100%');
});

test('deletes a session, and leaves a tombstone so it stays deleted', async () => {
  await withServer(async (base, dir) => {
    const res = await fetch(`${base}/session?s=abc123`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: 'abc123' });

    assert.equal(fs.existsSync(path.join(dir, 'abc123.md')), false);
    assert.equal(fs.existsSync(path.join(dir, 'abc123.json')), false);
    assert.ok(fs.existsSync(path.join(dir, 'abc123.deleted')), 'tombstone written');

    assert.deepEqual(await (await fetch(`${base}/api/sessions`)).json(), []);
  });
});

test('the transcript is never what gets deleted', async () => {
  await withServer(async (base, dir) => {
    // Only rendered files live here; nothing in this handler can reach
    // ~/.claude/projects, and the tombstone is all that is left behind.
    await fetch(`${base}/session?s=abc123`, { method: 'DELETE' });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['abc123.deleted']);
  });
});

test('refuses to delete what it cannot name safely', async () => {
  await withServer(async (base) => {
    for (const id of ['', '..%2F..%2Fetc%2Fpasswd', 'a%2Fb']) {
      const res = await fetch(`${base}/session?s=${id}`, { method: 'DELETE' });
      assert.equal(res.status, 404, `${id || '(empty)'} must not delete anything`);
    }
    assert.equal((await fetch(`${base}/session?s=nosuch`, { method: 'DELETE' })).status, 404);
  });
});

test('a foreign origin cannot delete anything', async () => {
  await withServer(async (base, dir) => {
    const res = await fetch(`${base}/session?s=abc123`, {
      method: 'DELETE',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
    assert.ok(fs.existsSync(path.join(dir, 'abc123.md')), 'the session survives');
  });
});

test('only DELETE deletes', async () => {
  await withServer(async (base, dir) => {
    assert.equal((await fetch(`${base}/session?s=abc123`)).status, 404);
    assert.ok(fs.existsSync(path.join(dir, 'abc123.md')));
  });
});
