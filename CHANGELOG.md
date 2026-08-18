# Changelog

## 1.0.0 — first public release

Packaged from a working personal setup (bash + jq scripts in `~/tools`, a
hand-written launchd plist, CDN-loaded browser libraries) into something a
stranger can install.

### Same behaviour, verified

The extractor was rewritten from bash + `jq` to Node. It was checked against the
original by rendering every transcript on the development machine with both
implementations: **27 of 27 conversations byte-identical**, `.md` and `.json`
sidecar alike, with matching exit codes including the `3`/unchanged and
`2`/bad-input paths. The `.md` format, the `<!--mdsv-->` markers, the noise
stripping, the turn folding and the mtime handling are unchanged.

### Deliberate differences from the original

- **No `jq`, no `lsof`, no `touch -r`, no bash.** Node is the only requirement.
  This is what makes the project work on Linux rather than macOS only.
- **Browser libraries are vendored** (`vendor/`) instead of loaded from a CDN.
  The viewer now works offline, and cannot be affected by a CDN outage or
  change. Adds ~500 KB to the repo, mostly KaTeX fonts (woff2 only).
- **`MAX_SESSIONS` default raised from 30 to 200**, and made configurable via
  `MDSERVE_MAX_SESSIONS`. At 30 the oldest sessions silently dropped out of the
  menu and became unreachable even by URL; the menu already scrolls, so a high
  value costs nothing.
- **A torn final line no longer discards the conversation.** `jq -s` failed on
  the whole file if the last line was half-written; the Node parser skips
  unparseable lines. It still reports "not settled" when the *last* line is the
  torn one, so the hook keeps waiting rather than publishing a turn that is
  still arriving — the retry behaviour is preserved.
- **The hook logs to `~/.mdserve/mdserve.log`**, not `/tmp/mdserve.log`. The old
  hook and the old plist disagreed about this; `/tmp` is wiped on reboot.
- **The login service is optional.** The hook already starts the server when it
  finds the port quiet, so `install --no-service` is a complete install.
- **Uninstall is surgical.** It removes only the hook entry it installed,
  identified by path, and backs up `settings.json` before touching it.

### New

- Single `mdserve` CLI: `serve`, `import`, `extract`, `hook`, `install`,
  `uninstall`, `status`.
- Claude Code plugin manifest, so the hook can be installed without editing
  `settings.json` at all.
- systemd user unit for Linux, alongside the launchd agent for macOS.
- 18 tests over synthetic fixtures, run with `node --test`.
- Path-traversal guards on both `/raw?s=` and `/vendor/`, with tests.
