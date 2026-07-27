# Video recording for twd-cli runs - Design

Date: 2026-07-27
Status: Ready to plan
Repo: `twd-cli` only. No twd-js changes.

## Problem

Cypress and Playwright can record video of a test run. `twd-cli` already runs
Puppeteer (`^25.3.0`) but uses no screenshot or screencast capability, so the
capability is sitting there unused.

## Primary use case

A shareable clip of a single flow:

```
npx twd-cli run --record --test "checkout flow"
```

The user turns their own tests into a product demo, a PR attachment, or a docs
clip. This framing keeps the feature out of the normal CI path entirely:
recording is always explicitly requested, never a default.

## Scope

In scope: everything needed to produce a video file from a `twd-cli run`.

Out of scope, deferred to a later spec in the `twd` repo: pacing the in-page
command loop and drawing in-page overlays (element highlights, step captions).
That is the real differentiator, since TWD owns its own command loop and can
space commands deliberately rather than recording a machine-speed blur, but it
requires changes inside twd-js. This spec ships the capture pipeline that work
will plug into. `record.speed` below is the interim pacing control.

Also out of scope: screenshots on failure. That needs a per-test event bridge
(see "One clip per run") and gets its own spec.

## External prerequisite: ffmpeg

`page.screencast()` spawns ffmpeg. Puppeteer's `ScreenRecorder` constructor does
`spawnSync(ffmpegPath)` and throws if it is missing. ffmpeg is therefore a hard
prerequisite for recording, documented in the README alongside the existing
`npx puppeteer browsers install chrome` step.

Puppeteer's own probe happens late, after browser launch and page navigation, and
produces an unhelpful error. twd-cli probes first: run
`spawnSync(ffmpegPath, ['-version'])` before `puppeteer.launch()` and fail fast
with install instructions for macOS, Linux, and Windows.

The probe only runs when recording is enabled, so non-recording users are
unaffected.

## Format

Puppeteer encodes `webm`, `mp4`, and `gif` natively, so no post-conversion step
is needed. Default is `mp4`: it embeds directly in GitHub PR comments, Slack, and
social posts, which is what the primary use case is for.

## Lifecycle

Ordered against the existing `runTests` flow in `src/index.js`:

1. Probe ffmpeg (recording only). Fail fast if absent.
2. `puppeteer.launch()`
3. `page.setViewport(record.viewport)` (recording only)
4. `page.goto(config.url)`
5. `page.waitForSelector('#twd-sidebar-root')`
6. `page.addStyleTag(...)` for framing (recording only)
7. `const recorder = await page.screencast({...})`
8. Enumerate handlers, resolve filters, run chunks (unchanged)
9. `await recorder.stop()`
10. `await browser.close()`

### Teardown is the main correctness risk

`recorder.stop()` must run before `browser.close()` on **both** the success path
and the `catch` path. If the browser closes first, the ffmpeg process is orphaned
and the output file is truncated or unplayable. The current `catch` block only
does `if (browser) await browser.close()`, so teardown needs restructuring so the
recorder is always stopped exactly once, including when a chunk throws or the run
is interrupted.

## Framing

Injected via `page.addStyleTag` when `record.hideSidebar` is true (the default):

```css
#twd-sidebar-root { display: none !important; }
html { margin-left: 0 !important; margin-right: 0 !important; }
```

Both rules are required. twd-js's `useLayout` hook sets
`document.documentElement.style.marginLeft = '280px'` as an **inline style** while
the sidebar is open, so hiding the sidebar root alone leaves a 280px blank gutter
in frame. `!important` is what beats the inline style, and it survives re-renders
that would otherwise reapply the margin.

A single `addStyleTag` is sufficient for the whole run because twd-js's `visit()`
navigates with `history.pushState` only and never does a hard document
navigation. If TWD ever adds real navigation, this must move to
`page.evaluateOnNewDocument`.

Hiding the sidebar is safe for execution: the runner lives on
`window.__testRunner` and `window.__TWD_STATE__`, independent of the sidebar UI.

## Viewport

twd-cli never calls `setViewport` today, so every run uses Puppeteer's implicit
800x600. With the sidebar open that leaves the app 520px wide, which is a poor
canvas for a shareable clip.

Recording sets its own viewport, defaulting to 1280x720 at
`deviceScaleFactor: 2`. `screencast()` derives video dimensions from viewport
times `devicePixelRatio`, so the scale factor is what makes the clip crisp rather
than soft.

The viewport is applied **only** when recording, so existing non-recording runs
keep their current behavior exactly.

## One clip per run

This produces exactly one video file containing every matched test, back to back,
in runner order.

This is forced, not chosen. `src/index.js:113` runs an entire chunk of up to
`chunkSize` tests inside a single `page.evaluate()`, so Node has no per-test hook
on which to stop and restart the recorder. Per-test files become possible only
once a `page.exposeFunction` event bridge exists (following the existing
`__twdCollectMock` precedent at `src/index.js:43`), which is the screenshot
spec's problem, not this one.

Two related behaviors worth documenting for users:

- `--test` is a **substring match on the full `"suite > test"` path**
  (`src/filterTests.js`), so a single `--test "Login"` can match several tests.
  Multi-test clips are the norm, not an edge case.
- `selectTestIds` iterates `handlers`, not `filters`, so **clip order is
  declaration order in the suite tree, not the order the flags were passed**.
  `--test "test 3" --test "test 1"` still records test 1 first.

## Filename

Named by what is actually in the file, not by the flags that selected it:

- Exactly one test recorded: slug of that test's full `"suite > test"` path, so
  `Login > shows error on bad password` becomes
  `login-shows-error-on-bad-password.mp4`. Lowercased, non-alphanumerics
  collapsed to single hyphens, trimmed, and truncated to a safe filename length.
- More than one test recorded: `run.mp4`.
- `record.filename` always overrides. The extension comes from `record.format`
  unless `filename` already carries one.

Naming by content avoids labelling a multi-test clip after one substring that
happened to match it. The primary single-flow use case still gets a
self-describing name for free.

`overwrite: true` is passed to `screencast()`, so re-runs replace the clip. This
matches how `coverage` and `.nyc_output` already behave.

## `record.speed`

Puppeteer's `ScreenRecorder` already supports a `speed` option that emits an
ffmpeg `setpts=1/speed*PTS` filter. This is exposed as `record.speed` and is the
only pacing control in this spec.

It is a **uniform stretch of the entire timeline**. It slows the fast parts and
the already-slow parts equally, and it cannot hold on a just-clicked element.
Real per-command pacing needs the deferred twd-js work. Default `1`.

## Config

```json
{
  "record": {
    "enabled": false,
    "dir": "./twd-artifacts",
    "filename": null,
    "format": "mp4",
    "viewport": { "width": 1280, "height": 720, "deviceScaleFactor": 2 },
    "fps": 30,
    "speed": 1,
    "hideSidebar": true,
    "ffmpegPath": "ffmpeg"
  }
}
```

### Shallow merge trap

`loadConfig` in `src/config.js` does `{ ...DEFAULT_CONFIG, ...userConfig }`. With
a nested `record` object, a user setting only `{"record": {"format": "webm"}}`
would **wipe every other record default** rather than merging. `loadConfig` needs
a one-level merge for this key. Every other config key stays flat and unchanged.

This is the first nested key in the config, so the merge behavior needs a test
that pins it.

### CLI flags

`parseArgs.js` currently understands only `--test` and returns
`{ testFilters }`. It grows a general flag parser returning
`{ testFilters, record }`. CLI flags win over `twd.config.json`.

The v1 flag set is exactly three:

| Flag | Config key |
|---|---|
| `--record` | `record.enabled = true` |
| `--record-dir <path>` | `record.dir` |
| `--record-speed <n>` | `record.speed` |

Everything else (`format`, `viewport`, `fps`, `hideSidebar`, `ffmpegPath`,
`filename`) is config-file only, to keep the flag surface small. `bin/twd-cli.js`
help text is updated to match.

`--record` does not require `--test`. Recording an unfiltered run is allowed and
produces `run.mp4`.

## Output

One line on completion, alongside the existing coverage and contract report
lines:

```
Recorded 3 test(s) to ./twd-artifacts/run.mp4
```

## Recording is not deterministic

A recorded run can pass or fail differently from a normal run. Setting a viewport
changes layout (today every twd-cli run is implicitly 800x600, and a responsive
test that passes there can fail at 1280x720), and hiding the sidebar reflows the
app to full width.

The docs must carry this plainly: **a recorded run is a demo artifact, not a
substitute for a CI run.** Users who want both should run CI normally and record
separately.

## Testing

Following the existing one-test-file-per-module convention in `tests/`:

- `config.test.js`: the nested `record` merge, including partial overrides and
  the absent-key case.
- `parseArgs.test.js`: the three flags, plus precedence over the config file.
- New unit for the filename rule: one test, many tests, `record.filename`
  override, and slug generation from a test path.
- `runTests.test.js`: extend the existing Puppeteer mock so `page.screencast`
  returns a fake recorder, and assert (a) `setViewport` and `addStyleTag` are
  called only when recording, (b) `recorder.stop()` is called before
  `browser.close()`, and (c) `recorder.stop()` still runs when a chunk throws.
- ffmpeg probe: assert the fast-fail path when the probe reports an error, and
  that the probe is skipped entirely when recording is disabled.

The ffmpeg probe and screencast are mocked throughout. No test in CI should
require a real ffmpeg binary.

## Open questions

- Whether `record.dir` should be added to `.gitignore` automatically, or just
  documented.
- Whether to emit a `gif` variant alongside `mp4` for README embedding, or leave
  that to the user via `record.format`.
- Long recordings: no size cap or duration guard is specified. Worth revisiting
  if unfiltered full-suite recording turns out to be a common use.

## Value

Video "like Cypress and Playwright", delivered through the architecture that
already matches theirs, and shipped in a change that touches only `twd-cli`. The
paced, annotated version that they cannot produce as cleanly then builds on this
same pipeline.
