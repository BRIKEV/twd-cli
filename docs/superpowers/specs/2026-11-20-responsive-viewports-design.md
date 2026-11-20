# Responsive runs: one pass per viewport - Design

Date: 2026-11-20
Status: Implemented.
Scope: `twd-cli`. Needs twd-js with viewports and a public
`TestRunner#viewportScope` (BRIKEV/twd#445, BRIKEV/twd#446).
Issue: BRIKEV/twd#444

## 1. Why

twd-js now lets an app name its breakpoints and tag tests with them:

```ts
// app side (twd-js)
twd({ viewports: { mobile: { maxWidth: 767 }, desktop: { minWidth: 1024 } } });
it('opens the burger menu', { viewport: 'mobile' }, async () => { /* ... */ });
```

In the browser, Run All only runs the tests matching the window width. twd-cli
runs every suite at one fixed size (`config.viewport`, 1280x800), so:

- The mobile tests never run in CI.
- Worse, they disappear without a word. twd-cli sends ids in chunks to
  `runByIds` and counts every id it sent as executed; twd-js drops the ids
  that do not match the width, so those tests are in no count and no report
  row. The run stays green and nothing says that tests were left out.

## 2. Principles

- **No breaking changes.** An app with no viewports, or an older twd-js, runs
  exactly as today: same output, same report, same exit code.
- **Zero config.** The app already declares the ranges; twd-cli derives a size
  from them. Config only overrides.
- **Each test runs once.** One row per test in `run.json`, so `merge`, shards,
  snapshots and the summary keep their invariants.
- **One page load, no reload.** A reload mints new test ids. Resizing with
  Puppeteer is enough: `setViewport` changes what `matchMedia` reports, which
  is what twd-js and the app's CSS both follow.
- **The matching rules live in twd-js.** twd-cli asks the page; it never
  reimplements inheritance, `defaultViewport` or range checks.

## 3. Flow

After the page is ready and filters (`--test`, `--changed-since`, `--shard`)
have produced the ordered id list, as today:

1. **Detect.** In the page: `window.__TWD_VIEWPORTS__` has at least one name,
   and `new window.__testRunner(events).viewportScope` is a function. If not,
   stop here and run as today. This happens inside the existing handler
   enumeration call, which now returns `{ handlers, viewports }`, so the
   number of page round-trips does not change.
2. **Plan.** Still in the page, without resizing:
   - Pass 1, at `config.viewport`: the selected ids in `viewportScope()`. This
     picks up untagged tests (unless the app sets `defaultViewport`) and the
     tests for whatever viewport that size matches.
   - Then one pass per declared viewport, in registry order: the selected ids
     in `viewportScope({ viewport: name })` that no earlier pass took. Empty
     passes are dropped.
   - What is left matches no declared viewport (a typo such as `deskop`). See
     section 6.
3. **Run.** For each pass, in order:
   - Pass 1 runs at `config.viewport`, as today.
   - For a later pass, `page.setViewport(size)` (section 4), then check in the
     page that every id of the pass is in `viewportScope()`. If not, the size
     does not match the app's range: stop with an error naming the viewport,
     the size, and the app's range, before running any of that pass.
   - Run the pass's ids in chunks through `runByIds`, as today. Order within a
     pass is the usual pre-order.
4. **Finish** as today: coverage, report, summary. `maxFailures` counts across
   all passes; when it stops the run, the remaining tests of every pass are
   "not run", as today.

Example console output:

```
Running 58 test(s) across 2 viewport(s)
  desktop 1280x800: 56 test(s)
  mobile 767x800: 2 test(s)
```

## 4. Picking a size

For each viewport after pass 1, in this order:

1. `viewportSizes.<name>` in `twd.config.json`, when set:
   ```json
   "viewportSizes": { "mobile": { "width": 390, "height": 844 } }
   ```
2. `config.viewport.width` if it is inside the range (then the viewport was
   already covered by pass 1 and has nothing left, so in practice this only
   matters for overlapping ranges).
3. The range's `maxWidth`, else its `minWidth`. Mobile `{ maxWidth: 767 }`
   runs at 767, tablet `{ minWidth: 768, maxWidth: 1023 }` at 1023, desktop
   `{ minWidth: 1024 }` at 1024.

Height and `deviceScaleFactor` come from `config.viewport` unless the override
sets them. The name `viewportSizes` avoids a second key that differs from the
existing `viewport` by one letter.

A configured size that falls outside the app's range is caught by the check in
step 3 of the flow, with an error, never by a silently empty pass.

## 5. Report and console

Additive only, so older readers and `merge` keep working:

- Each test row in `run.json` gets `viewport`: the pass it ran in (a name, or
  `null` for pass 1 when the size matches no declared viewport).
- The run header gets `viewports`: one entry per pass,
  `{ name, width, height, tests }`.
- The console prints the plan before running (section 3) and one line per pass
  in the summary. Markdown and HTML reports group failures by nothing new; each
  failed test shows its viewport next to its path.

When no viewports are declared, neither field is written and the output is
byte for byte what it is today.

## 6. Tests that match no viewport

A test whose viewport name the app never declared can never run. It is
reported as **skipped**, with `skipReason: "viewport"` and the unknown names,
and the console prints a warning listing them. It counts as executed for the
arithmetic (`executed + notRun = selected`), so shards and `merge` stay
consistent. The exit code does not change, matching twd-js, which only warns
about unknown names in the browser.

## 7. Limits (kept simple on purpose)

- **Recording** (`--record` or `record.enabled`) runs pass 1 only, at
  `record.viewport`: the video has one fixed size. Tests for other viewports
  are reported as skipped with `skipReason: "viewport"` and the console says
  why. Per-viewport videos can come later.
- **`--repeat`** runs pass 1 only and **leaves the other viewports out** of
  the run, with a console line, instead of reporting them as skipped rows. It
  reloads between rounds (which this design otherwise avoids) and joins rounds
  by position; adding rows for tests that never run would complicate that for
  a niche flag.
- **Layout snapshots** need no change. Each test runs once at one size, so its
  reference is always taken at that size. Changing a `viewportSizes` override
  changes the size, and twd-js already fails the snapshot in CI with a
  viewport-mismatch message, so the user knows to update the reference.
- **No new flags.** Running a single viewport (`--viewport mobile`) is not in
  this version; `--test` covers debugging one test.

## 8. Compatibility

| Setup | Behavior |
|---|---|
| App without viewports | As today |
| twd-js older than viewports | As today (no registry, no `viewportScope`) |
| App with viewports, new twd-cli | Passes per viewport |
| App with viewports, current twd-cli (1.11) | Pass 1 only; other tests silently missing (the bug in section 1). Upgrading twd-cli fixes it |

## 9. Testing plan

Tests first, per the repo rule, in `tests/` with the existing mocks of the
page:

- Planning: pass 1 from `viewportScope()`; later passes from named scopes;
  each test assigned once; empty passes dropped; leftovers become skipped with
  the reason; filters and shards applied before planning.
- Sizes: override, current width in range, `maxWidth`, `minWidth`, height
  inherited.
- Size check: a pass whose ids are not in scope after the resize fails before
  running, with the message.
- Unchanged paths: no registry, no `viewportScope`, recording, `--repeat`.
- Report: `viewport` per row, `viewports` header, absent without viewports;
  `merge` of two shards with viewports.
- End to end in `test-example-app`: declare `mobile` and `desktop`, tag one
  test per viewport, check both run and the report shows them. Needs the twd-js
  release with viewports, or a local link until then.

## 10. Decisions

1. **`viewportSizes`** is the key name, kept apart from `viewport` by more than
   one letter.
2. **Unknown names only warn**, like twd-js. A CI that wants it strict could
   fail on it later behind a flag.

Verified end to end in `test-example-app` against a local twd-js build:
desktop at 1280x800 and mobile at 390x844 (from `viewportSizes`) in one run,
an undeclared `deskop` tag reported as skipped with the warning, a
`viewportSizes` outside the range stopping the run with exit 1, and the same
app without viewports printing exactly what it printed before.
