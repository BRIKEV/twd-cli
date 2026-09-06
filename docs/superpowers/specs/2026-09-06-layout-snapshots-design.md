# Layout snapshots in twd-cli - Design

Date: 2026-09-06
Status: Approved. Scoped down to a POC on 2026-09-06, see section 8.
Scope: `twd-cli` only.
Companion: `twd-js` ships `twd.matchLayout` in 1.10.0. Its design lives in that
repo at `specs/2026-09-06-matchlayout-implementation-design.md`, and the spike
behind it at `specs/2026-09-03-matchlayout-design.md`.

## 1. Why twd-cli is involved at all

`twd.matchLayout` captures a DOM node to a grid of bits and compares it against
a committed `.snap` reference, failing when the page geometry moved. It is
deliberately **off by default in the browser sidebar**: the sidebar resizes the
page, and a developer's viewport is whatever their window happens to be, so a
reference created there would fail for everybody else.

That makes `twd-cli` the place where a layout snapshot is actually decided. This
document covers what `twd-cli` has to do to hold up that end.

## 2. What this adds

| Piece | Where |
|---|---|
| `--update-snapshots` and `--ci` flags | `src/parseArgs.js` |
| `viewport` and `snapshotDir` config keys | `src/config.js` |
| An always-applied viewport | `src/index.js` |
| Window flag injection before navigation | `src/index.js` |
| A self-contained HTML failure report | `src/snapshotReport.js` (new) |

## 3. Flags

Two boolean flags, parsed like the existing `--record`:

```
npx twd-cli run --update-snapshots
npx twd-cli run --ci
```

They stay two separate flags on purpose, the way Jest separates them, because
they close two different holes:

- **`--update-snapshots`** rewrites references that already exist. Without it a
  changed layout fails, which is the point.
- **`--ci`** forbids *creating* a reference. Without it, a brand new test writes
  its own baseline on the first CI run and passes, forever, and nobody finds
  out. That is the expensive failure, because it makes no noise.

`--ci` outranks `--update-snapshots`. Both set, with no reference on disk, is a
failure and not a write.

**That precedence is not implemented here.** `twd-cli` only sets both window
flags and lets `matchLayout` decide, because the decision needs the reference
that only the browser side has fetched. Do not reimplement the ordering in the
CLI: two copies of a rule drift.

## 4. Config

Two new top-level keys, with defaults:

```json
{
  "viewport": { "width": 1280, "height": 800 },
  "snapshotDir": "__twd_snapshots__"
}
```

`snapshotDir` has to match the `dir` option given to the `twdSnapshot` Vite
plugin. The two live in different processes that never talk, so this is
duplication that cannot be designed away. It gets documented rather than
hidden.

`viewport` is flat, unlike `record.viewport`, which stays nested under `record`
and keeps its own meaning as the video's dimensions.

## 5. The viewport, and the behaviour change it brings

`src/index.js` currently calls `page.setViewport()` **only when recording**.
Every other run inherits Puppeteer's implicit default.

That is not good enough for snapshots. The whole anti-flaky promise of
`matchLayout` is that the viewport under `twd-cli` is fixed. Today it would be
fixed only by accident, and a Puppeteer upgrade that changed its default would
invalidate every committed reference at once, silently.

So `page.setViewport(config.viewport)` runs on **every** run. When recording,
`record.viewport` still wins, so recording behaves exactly as it does today.

**This changes existing behaviour.** Runs that do not record move from
Puppeteer's implicit size to 1280x800. A test that happens to depend on the old
size can start failing. This belongs in the CHANGELOG in plain words, not in a
footnote.

## 6. Injecting the flags

In `src/index.js`, **before `page.goto`**:

```js
await page.evaluateOnNewDocument((f) => {
  window.__TWD_SNAPSHOTS__ = true;
  if (f.update) window.__TWD_UPDATE_SNAPSHOTS__ = true;
  if (f.ci) window.__TWD_SNAPSHOT_CI__ = true;
}, { update, ci });
```

`evaluateOnNewDocument`, never `evaluate`. It runs before any script on the
page, so the flags are already set by the time `matchLayout` reads them. The
`twdSnapshot` Vite plugin sets its own flag with `??=` precisely so this
injection wins.

`__TWD_SNAPSHOTS__` is always true under `twd-cli`. That is the entire point:
this is where the verdict lives.

## 7. The HTML report

A failure writes `<name>.failed.png` next to the reference, on the machine that
ran the test. In CI that machine disappears, so the picture is unreachable
exactly when it is most needed.

`src/snapshotReport.js` reads `<snapshotDir>/*.failed.png`, embeds each one as a
`data:` URI, and writes a single self-contained page to **`.twd/snapshot-report.html`**.

Two decisions worth stating:

- **It goes in `.twd/`, not next to the PNGs.** `__twd_snapshots__/` holds the
  `.snap` files that get committed. `.twd/` holds run output. Keeping ephemeral
  artefacts out of a committed directory is worth the extra path.
- **Self-contained, so one artifact carries everything.** A CI job uploads one
  file and the reviewer opens it in a browser, instead of downloading a zip of
  loose PNGs and matching them up by filename.

The report needs nothing from `twd-js`. The PNGs are already on disk, and the
snapshot name is the filename minus `.failed.png`. That keeps the two packages
uncoupled for this half of the feature.

It is written only when there is at least one failure. A clean run leaves no
file.

The path is fixed for the beta rather than configurable. One less knob to
document while nobody has asked for it, and `--report-dir` already exists for
sharding and means something different.

## 8. No summary line, and no dependency on twd-js

An earlier draft counted snapshots in the final block (`3 snapshots written, 1
updated`), to make it visible when `--update-snapshots` had been left on and had
quietly rewritten every reference.

**Dropped.** A flag left on in a workflow is a user error, and this is a beta
that nobody has run in a real environment yet. Building a guard against a
failure mode we have not actually seen is guessing, and it would have cost
either a new `window` contract in `twd-js` or a before-and-after hash of every
`.snap` on disk.

The consequence, stated plainly so it is a decision and not a surprise: a run
with `--update-snapshots` rewrites references and reports nothing. Revisit this
only if it bites someone in real use.

What this buys: **`twd-cli` needs nothing at all from `twd-js` beyond the window
flags it already reads.** Failures still surface through the normal path, since
`matchLayout` throws and the test fails with its message and a non-zero exit
code, and the HTML report is built purely from the PNGs on disk.

## 9. Error handling

- **Snapshot directory missing.** Not an error. It means no snapshots ran, or
  none failed. No report, no line, no warning.
- **A PNG that cannot be read.** Skip that entry, keep the rest of the report,
  and note the skipped file in the report itself. One unreadable file must not
  cost the reviewer the other nine.
- **`.twd/` not writable.** Warn and carry on. Failing a run because the report
  could not be written would turn a diagnostic aid into a new failure mode. The
  test results are what the exit code is for.

## 10. Testing

`twd-cli` keeps one `tests/*.test.js` per `src/` file, and that pattern holds:

- `tests/parseArgs.test.js`: both flags in `--flag` form, combined, absent, and
  that they do not disturb the existing flags.
- `tests/config.test.js`: the two new keys default correctly, a partial
  `viewport` in the file merges rather than wiping the default, and
  `record.viewport` still behaves as before.
- `tests/snapshotReport.test.js`: a directory with two failure PNGs yields one
  HTML file containing two `data:` URIs and both snapshot names; an empty or
  missing directory yields no file; an unreadable file is skipped with the rest
  intact.
- `tests/testSummary.test.js`: the line appears with counts, is omitted for an
  empty list, and handles written-only and updated-only.

The Puppeteer wiring in `src/index.js` (injection and `setViewport`) is not unit
tested, matching how the rest of that file is treated. It is exercised by
`test-example-app` manually.

## 11. Out of scope

- Merging snapshot results across shards. The two features are both beta and
  combining them now would design against guesses.
- Any GitHub Actions job summary integration. Rejected outright: it would put
  noise on pull requests.
- Uploading images anywhere external so they can be linked. That is the model
  this whole feature exists to avoid.
- Recovering the ASCII preview in the failure message. That is `twd-js` work and
  is happening separately.
