'use strict';
/**
 * The viewer is one file: markup, styles and script together. Nothing type
 * checks it, so a renamed id fails silently in the browser and nowhere else.
 * These tests read the file as text and pin the joins between its three parts.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'viewer.html'), 'utf8');
const SCRIPT = HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));

const idsInMarkup = new Set(
  [...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
);

test('the script only reaches for elements that exist', () => {
  const wanted = [...SCRIPT.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);

  assert.ok(wanted.length > 10, 'sanity: the script does look elements up');
  for (const id of wanted) {
    assert.ok(idsInMarkup.has(id), `#${id} is used by the script but is not in the markup`);
  }
});

test('every aria-controls points at a real element', () => {
  for (const [, id] of HTML.matchAll(/aria-controls="([^"]+)"/g)) {
    assert.ok(idsInMarkup.has(id), `aria-controls="${id}" points at nothing`);
  }
});

test('both panes fold, and the sidebar folds away entirely', () => {
  // The panes.
  assert.match(SCRIPT, /makeFoldable\(sessionPane, sessionToggle,/);
  assert.match(SCRIPT, /makeFoldable\(turnPane, turnToggle,/);
  assert.match(HTML, /#sessionPane\.collapsed #sessionBody/);
  assert.match(HTML, /#turnPane\.collapsed #turnBody/);

  // The sidebar.
  assert.match(HTML, /#shell\.no-sidebar aside \{ display: none; \}/);
  assert.match(SCRIPT, /sidebarToggle\.onclick/);

  // Three independent choices, three distinct keys.
  const keys = [...SCRIPT.matchAll(/'(mdserve\.[a-z.]+)'/g)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'remembered state must not share keys');
});

test('the script parses', () => {
  assert.doesNotThrow(() => new Function(SCRIPT));
});

test('the turn marker matches the one the extractor writes', () => {
  const { buildConversation } = require('../src/extract');
  const built = buildConversation([
    { type: 'user', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/x', message: { content: 'hi' } },
  ]);

  // What the viewer splits on has to match what extract.js emits, or the page
  // renders one undifferentiated blob.
  assert.ok(built.text.startsWith('<!--mdsv u '));
  assert.match(SCRIPT, /<!--mdsv/);
});
