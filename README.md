# mdserve

Read your Claude Code conversations in a browser.

mdserve turns the transcripts Claude Code already writes into a navigable web
page at **http://localhost:4577** — an index of every question you asked, LaTeX
rendered, code highlighted, and the page updating itself the moment a turn ends.

It is a reader, not a recorder. Your transcripts are the source of truth and
mdserve never writes to them.

---

## How it works

```
Claude Code finishes a turn
        │
        ▼
   Stop hook  ──►  mdserve hook       (works out which session this is)
                        │
                        ▼
                  mdserve extract     (rebuilds the WHOLE conversation)
                        │
                        ▼
            ~/.mdserve/sessions/<id>.md
                        │
                        ▼
                  mdserve serve       (watches the folder, pushes over SSE)
                        │
                        ▼
                  your browser        (updates itself)
```

The one idea worth knowing: every turn rebuilds the conversation **from
scratch** rather than appending to it. That makes the operation repeatable
forever without duplicates, and it means a conversation from before you
installed mdserve can still be imported afterwards.

---

## Requirements

- **Node 18 or newer.** That is the whole dependency list — no npm packages at
  runtime, and the browser libraries are vendored in `vendor/`, so the viewer
  works with no network at all.
- **Claude Code**, with transcripts in `~/.claude/projects/`.
- macOS or Linux. Windows is untested; `mdserve serve` will probably work,
  the login service will not.

---

## Install

### As a Claude Code plugin

```
/plugin marketplace add ThePowerSet/mdserve
/plugin install mdserve
```

The plugin ships its own `Stop` hook, so nothing edits your `settings.json` and
uninstalling is clean. The server starts on demand the first time a turn ends.

> The plugin manifest in `.claude-plugin/` is provided as-is; if Claude Code's
> plugin format has moved on since this was written, check it against the
> current docs before relying on it. The manual install below does not depend
> on the plugin system at all.

### From a clone

```sh
git clone https://github.com/ThePowerSet/mdserve.git
cd mdserve
./scripts/install.sh
```

That registers the `Stop` hook in `~/.claude/settings.json` (backing the file up
first) and installs a login service so the viewer is up before you ask anything.
Use `./scripts/install.sh --no-service` to skip the service and let the hook
start the server on demand.

Then pull in what you have already said:

```sh
node bin/mdserve.js import all      # every conversation on disk
node bin/mdserve.js import 30       # just the 30 newest
```

### Without installing anything

```sh
node bin/mdserve.js serve
```

Serves whatever has already been rendered. No hook, no service, no live updates.

---

## Using the page

- **Session menu**, top left. *Latest* always follows whichever session answered
  most recently. Click a session to pin it; the choice lands in the URL as
  `?s=<id>` and survives a reload — which is how you keep two Claude Code
  sessions open on two monitors.
- **Fold the session menu away** by clicking its `Sessions` header. Collapsed, it
  shows just the session you are reading and hands the rest of the sidebar to
  the question index. The choice is remembered between visits.
- **Delete a session** with the `×` that appears when you hover over its row.
  One click arms it, a second confirms — no dialog. See below for what that
  does and does not remove.
- **Question index**, below it: one line per prompt, clickable.
- **Keyboard**: `j` next question, `k` previous, `g` top, `G` bottom.
- **Follow** switches itself off the moment you jump to a question, so you are
  not yanked to the bottom while reading back. The `latest` button re-arms it.
- **The dot, top left**: green means connected to the server, red means not.
- Very long prompts fold themselves up, with a *show more*.

### What it deliberately does not show

Prose only: no tool calls, no command output, no thinking blocks, no sub-agent
conversations. A turn made entirely of tool calls with no text simply does not
appear. That is the design, not a bug — it is what makes a long session
readable. If you want any of it back, see the table below.

---

## Commands

```sh
mdserve serve [dir]          # run the viewer in the foreground
mdserve import [n|all]       # render past conversations (default: 30 newest)
mdserve extract <file.jsonl> # re-render one conversation
mdserve status               # what is running, and where
mdserve install [--no-service]
mdserve uninstall
```

`import` and `extract` are always safe to re-run: they rebuild, never append.

`extract` exit codes: `0` written, `1` nothing renderable (or the transcript is
still being written), `2` not a readable transcript, `3` unchanged — the
rebuilt conversation was identical to what was already on disk.

---

## Where things live

| Path | What |
|---|---|
| `~/.mdserve/sessions/<id>.md` | The rendered conversation. One per session. |
| `~/.mdserve/sessions/<id>.json` | Title, working directory, turn count — for the menu. |
| `~/.mdserve/sessions/<id>.deleted` | Tombstone: this session was deleted and must not come back. |
| `~/.mdserve/mdserve.log` | Server log. Deliberately not in `/tmp`, which reboots wipe. |
| `~/.claude/projects/<project>/<uuid>.jsonl` | The transcripts. **Read-only, for us.** |
| `~/.claude/settings.json` | Where the `Stop` hook is registered (manual install). |

`<id>` is the session UUID, the same as the transcript filename.

### Configuration

Everything is an environment variable; there is no config file.

| Variable | Default | What |
|---|---|---|
| `MDSERVE_PORT` | `4577` | Port to listen on. |
| `MDSERVE_DIR` | `~/.mdserve/sessions` | Where rendered conversations go. |
| `MDSERVE_MAX_SESSIONS` | `200` | How many sessions the menu lists. |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Where transcripts are read from. |

### Changing behaviour

| I want to... | File | Where |
|---|---|---|
| Change colours, fonts, theme | `src/viewer.html` | the `:root` block at the top |
| Change sidebar width | `src/viewer.html` | `--sidebar` in `:root` |
| Change keyboard shortcuts | `src/viewer.html` | search for `keydown` |
| Change how far long prompts fold | `src/viewer.html` | search for the fold threshold |
| Strip more noise from prompts | `src/extract.js` | `stripNoise` |
| Include sub-agent conversations | `src/extract.js` | the `isSidechain` filter in `buildConversation` |
| Include tool calls or thinking | `src/extract.js` | `textOf`, which keeps only `type === 'text'` |

`src/viewer.html` is read **once, at startup**. After editing it, restart the
server or the browser keeps getting the old page. `src/extract.js` runs afresh
every turn, so changes there are live immediately.

---

## Deleting a session

Deleting from the page removes the **rendering**, not the conversation. The
transcript in `~/.claude/projects/` is never touched — mdserve has no code path
that writes there at all.

Because the renderer rebuilds from the transcript, a plain delete would undo
itself at the next turn, or at the next `mdserve import all`. So a delete leaves
an empty `<id>.deleted` file behind, and both the hook and the importer skip any
session that has one.

To bring a deleted conversation back:

```sh
rm ~/.mdserve/sessions/<id>.deleted
mdserve import all
```

Deleting is only offered over `DELETE /session?s=<id>`, from the loopback
interface, and requests announcing a foreign origin are refused — a page in
another tab cannot quietly delete your conversations.

## The `.md` format

Each block is introduced by an HTML comment, invisible once rendered:

```markdown
<!--mdsv u 2026-08-16T18:16:55.257Z-->

the question

<!--mdsv a 2026-08-16T18:16:58.428Z-->

the answer
```

`u` is you, `a` is the assistant, then an ISO timestamp. This is what the page
splits turns on. **Change the marker and you must change it in both**
`src/extract.js` and `src/viewer.html`.

A transcript that happens to contain the marker itself has it defused on the way
in, so nothing you paste into a prompt can forge a turn boundary.

The `.md` file's mtime is set to the transcript's, because the menu sorts by
date: without that, a bulk import would list every conversation in the order it
happened to be processed.

---

## Privacy

**mdserve serves your conversations over HTTP.** They may contain anything you
have ever pasted into Claude Code — keys, client work, personal things.

- The server binds to `127.0.0.1` only. This is the entire access control, and
  it is not configurable on purpose. Do not put it behind a tunnel or a reverse
  proxy without thinking hard about who can reach it.
- There is no authentication. Anything running on your machine that can make an
  HTTP request can read every conversation.
- Nothing leaves your machine. There is no telemetry, and the vendored browser
  libraries mean the page makes no external requests either.

---

## Troubleshooting

**The page will not load.** Check the server is up with `mdserve status`. If it
is not, look at `~/.mdserve/mdserve.log`.

**The page loads but is stuck on an old conversation.** Is the dot red? Then the
connection dropped — reload. If it is green, the problem is upstream, in the
hook.

**A conversation does not update when a turn ends.** Check the hook is still
registered: `mdserve status`. Then try it by hand:

```sh
echo '{"transcript_path":"'"$HOME"'/.claude/projects/<project>/<uuid>.jsonl"}' \
  | node bin/mdserve.js hook
node bin/mdserve.js extract ~/.claude/projects/<project>/<uuid>.jsonl
```

The hook retries for about 4.5 seconds, because the last message of a turn is
often not yet flushed to disk when `Stop` fires.

**A conversation does not appear at all.** A session with no prose in it — one
you opened and never used, or one made entirely of tool calls — is skipped on
purpose.

**I changed the look and nothing happened.** `src/viewer.html` is read at
startup. Restart the server.

**I broke something in the scripts.** Every `.md` is regenerable:
`mdserve import all`. The original transcripts are never touched, so nothing is
lost.

---

## Compatibility

mdserve reads fields of Claude Code's transcript format that are not part of any
public contract — `isSidechain`, `isMeta`, `ai-title`, `last-prompt`, and the
shape of `message.content`. **This is the thing most likely to break.** If a
Claude Code update changes the format, conversations may render oddly or stop
rendering; the fix is confined to `src/extract.js`, and `mdserve import all`
puts everything right again afterwards.

Last verified against transcripts written in August 2026.

---

## Uninstall

```sh
./scripts/uninstall.sh
```

Removes the login service and the `Stop` hook — and only the hook it installed
itself; anything else in your `settings.json` is left alone, with a backup taken
first. Rendered conversations in `~/.mdserve/sessions/` are deliberately left in
place. Delete them yourself if you want them gone.

---

## Development

```sh
node --test      # 18 tests, no dependencies
```

The tests pin the extractor's rules — turn folding, noise stripping, sub-agent
exclusion, idempotence, marker forgery — and what the server refuses to serve.
The fixtures in `test/fixtures/` are synthetic; no real conversation is in this
repo.

---

## A note on durability

The `.md` files in `~/.mdserve/sessions/` are an independent copy. If Claude Code
ever cleaned up `~/.claude/projects/`, conversations already rendered would stay
readable — but from that point they would no longer be regenerable. If a
conversation genuinely matters, copy its `.md` somewhere else.

---

## Licence

MIT — see [LICENSE](LICENSE).

Bundled in `vendor/`, each under its own licence:
[marked](https://github.com/markedjs/marked) (MIT),
[KaTeX](https://katex.org) (MIT),
[highlight.js](https://highlightjs.org) (BSD-3-Clause).
Licence texts are alongside them.
