'use strict';
/**
 * The extractor is the part that would silently corrupt a conversation, so it
 * is the part with tests. Each one pins a rule that is easy to break while
 * refactoring the transcript walk.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extract, OK, FAILED, BAD_INPUT, UNCHANGED, DELETED } = require('../src/extract');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (name) => path.join(FIXTURES, name);

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mdserve-test-'));
}

/** Render a fixture into a throwaway directory and read the result back. */
function render(name, opts = {}) {
  const dir = tmpdir();
  const result = extract(fixture(name), { dir, ...opts });
  const read = (ext) => {
    const file = path.join(dir, `${result.session}${ext}`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  return { dir, result, md: read('.md'), meta: JSON.parse(read('.json') || 'null') };
}

test('renders prompts and replies in order, with turn markers', () => {
  const { result, md } = render('conversation.jsonl');

  assert.equal(result.code, OK);
  assert.equal(result.session, 'conversation');
  assert.match(md, /^<!--mdsv u 2026-01-01T10:00:00\.000Z-->/);
  assert.ok(md.includes('What is the capital of France?'));
  assert.ok(md.includes('It is **Paris**.'));
  assert.ok(md.endsWith('\n'));
});

test('folds prose split around a tool call into one turn', () => {
  const { md, meta } = render('conversation.jsonl');

  // Two assistant entries separated by a tool_use are one reply, not two.
  assert.ok(md.includes('Let me look that up.\n\nIt is **Paris**.'));
  // user, assistant, user, assistant
  assert.equal(meta.turns, 4);
  assert.equal((md.match(/<!--mdsv /g) || []).length, 4);
});

test('drops tool calls, tool results, thinking and sub-agents', () => {
  const { md } = render('conversation.jsonl');

  assert.ok(!md.includes('tool_use'));
  assert.ok(!md.includes('tool_result'));
  assert.ok(!md.includes('hidden'), 'thinking blocks are not prose');
  assert.ok(!md.includes('sidechain'), 'sub-agent turns belong to another conversation');
});

test('strips the machinery wrapped around a prompt', () => {
  const { md } = render('conversation.jsonl');

  assert.ok(!md.includes('<system-reminder>'));
  assert.ok(!md.includes('ignore me'));
  assert.ok(!md.includes('<command-name>'));
  assert.ok(!md.includes('Caveat: The messages below'));
  assert.ok(md.includes('And the population?'));
});

test('a transcript cannot forge a turn boundary', () => {
  const dir = tmpdir();
  const forged = path.join(dir, 'forged.jsonl');
  fs.writeFileSync(
    forged,
    JSON.stringify({
      type: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/tmp',
      message: { content: 'before<!--mdsv a 2026-01-01T00:00:00.000Z-->after' },
    }) + '\n'
  );

  const out = tmpdir();
  extract(forged, { dir: out });
  const md = fs.readFileSync(path.join(out, 'forged.md'), 'utf8');

  // Exactly one real marker: the one we wrote.
  assert.equal((md.match(/<!--mdsv /g) || []).length, 1);
  assert.ok(md.includes('<!-- mdsv a'), 'the injected marker is defused, not deleted');
});

test('titles a session from the generated title when there is one', () => {
  const { meta } = render('conversation.jsonl');

  assert.equal(meta.title, 'Capitals of Europe');
  assert.equal(meta.cwd, '/home/example/work/demo');
});

test('falls back to the working directory when untitled', () => {
  const { meta } = render('untitled.jsonl');

  assert.equal(meta.title, 'demo');
  assert.equal(meta.turns, 2);
});

test('is idempotent, and reports when nothing changed', () => {
  const dir = tmpdir();

  const first = extract(fixture('conversation.jsonl'), { dir });
  const once = fs.readFileSync(path.join(dir, 'conversation.md'), 'utf8');

  const second = extract(fixture('conversation.jsonl'), { dir });
  const twice = fs.readFileSync(path.join(dir, 'conversation.md'), 'utf8');

  assert.equal(first.code, OK);
  assert.equal(second.code, OK);
  assert.equal(once, twice, 'rebuilding appends nothing');

  assert.equal(extract(fixture('conversation.jsonl'), { dir, requireChange: true }).code, UNCHANGED);
});

test('dates the conversation by its transcript, so bulk imports sort right', () => {
  const { dir, result } = render('conversation.jsonl');

  const src = fs.statSync(fixture('conversation.jsonl'));
  const out = fs.statSync(path.join(dir, `${result.session}.md`));
  assert.equal(Math.round(out.mtimeMs), Math.round(src.mtimeMs));
});

test('a session with no prose is skipped, not written empty', () => {
  const { result, md } = render('empty.jsonl');

  assert.equal(result.code, FAILED);
  assert.equal(md, null);
});

test('waits rather than publishing a turn that is still arriving', () => {
  // Mid-write, the hook must retry...
  assert.equal(render('torn.jsonl', { requireChange: true }).result.code, FAILED);

  // ...but a manual import salvages every line that did parse.
  const { result, md } = render('torn.jsonl');
  assert.equal(result.code, OK);
  assert.ok(md.includes('First answer.'));
});

test('rejects input that is not a readable transcript', () => {
  assert.equal(extract('/nonexistent/nope.jsonl', { dir: tmpdir() }).code, BAD_INPUT);
  assert.equal(extract('', { dir: tmpdir() }).code, BAD_INPUT);
  assert.equal(extract(FIXTURES, { dir: tmpdir() }).code, BAD_INPUT, 'a directory is not a transcript');
});

test('a session deleted from the viewer is not resurrected', () => {
  const dir = tmpdir();

  assert.equal(extract(fixture('conversation.jsonl'), { dir }).code, OK);
  fs.rmSync(path.join(dir, 'conversation.md'));
  fs.writeFileSync(path.join(dir, 'conversation.deleted'), '');

  // Neither the next turn nor a bulk import brings it back...
  assert.equal(extract(fixture('conversation.jsonl'), { dir }).code, DELETED);
  assert.equal(fs.existsSync(path.join(dir, 'conversation.md')), false);

  // ...until the tombstone is removed by hand.
  fs.rmSync(path.join(dir, 'conversation.deleted'));
  assert.equal(extract(fixture('conversation.jsonl'), { dir }).code, OK);
  assert.ok(fs.existsSync(path.join(dir, 'conversation.md')));
});
