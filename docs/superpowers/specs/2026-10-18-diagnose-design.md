# `twd-cli run --diagnose` (a TWD doctor) - Design

Date: 2026-10-18
Status: Proposal. Needs refinement before anyone starts on it.
Scope: `twd-cli` only.

## 1. Why

A slow, flaky CI job in a real TWD suite (about 320 tests on a 2-vCPU GitHub
runner) took two weeks to explain, and every cause was invisible from
twd-cli's output. A run said "Passed: 322, Retried (4)" and a duration; nothing
pointed at a cause. Each cause took a custom script to find. The fixes were
app-specific, but the **way they were found** is generic, and every TWD user
with a slow CI needs the same checks.

What was found, and how:

| Problem | Effect | How it was found |
|---|---|---|
| A third-party tag in `index.html` re-subscribed listeners on every SPA navigation | ~1,800 listeners on `window` after ~230 tests; each pass in the same tab slower than the last (254 → 335 → 405s); timing flakes | `page.metrics().JSEventListeners` and per-test duration over the run |
| Unmocked API calls hitting a dead port | ~120 failed requests per run in 40 tests; the app retries with a delay, so tests wait | `page.on('requestfailed')` attributed to the running test |
| Third-party hosts (payment analytics, review widgets, CDNs) | ~50 failed requests per run, network the test does not need | Same, grouped by host |
| zone.js loaded although the telemetry that needed it was off | Patches every promise, timer and listener | `typeof window.Zone` |
| Cross-origin iframes (payment provider fields) | Up to 8 extra renderer processes on a 2-vCPU machine | `browser.targets()` |
| CI is CPU-bound | Local runs fast and green; CI slow and retried | `--cpu-throttle 2` reproduced CI time within 1% |
| Tests that only pass on retry | Hidden flakes, ~20s each on CI | Per-test attempt counts |

What did **not** matter, so the doctor must not nag about it: istanbul
coverage (-0.3%, 3 runs each, within noise), site isolation (no measurable
effect), memory growth from detached DOM nodes (real, but cost no time).

## 2. Shape

A flag on a normal run, not a separate command, so it diagnoses the real suite
with the real config:

```bash
npx twd-cli run --diagnose
```

The tests run exactly as usual: same retries, same exit code. On top,
twd-cli collects a few signals per chunk and per test and prints a
**Diagnosis** block after the run summary.

The cost of collecting must stay small: one `page.metrics()` per chunk, one
`requestfailed` / `requestfinished` listener, a `browser.targets()` count per
chunk. No CPU profiling, because it distorts the timings it would explain.

## 3. Output lives in `run.json`

The diagnosis is a `diagnosis` block inside `run.json`, not a separate
`diagnosis.json`. A new file would have to be added to `OWNED_ENTRIES`, taught
to `cleanReportDir`, merged across shards and versioned on its own. A block in
`run.json` gets all of that from the existing report pipeline, and the HTML
report and `summary.md` render it the way they render Needs attention.

Printed after `--- Run complete ---`, only the checks that tripped, most
costly first:

```
--- Diagnosis ---
  ⚠ Event listeners grew 21x during the run (1,900 → 41,000)
    Top growing: vendor_consent_changed (+1,796), vendor_link_click (+448)
    Tests in the second half ran 38% slower.
    → A script subscribes on every navigation. Skip third-party tags under
      automation: if (navigator.webdriver) return;
  ⚠ 41 unmocked requests to your API per run (22 tests)
    GET /api/orders/:id   41  (Payment Flow > ..., +21 more)
    → Mock them; if your client retries, these tests wait on the delay.
  ℹ 4 third-party hosts, 52 failed requests (analytics.payments.example 47)
  ℹ zone.js is loaded (window.Zone)
  ℹ Runner: 2 vCPU on CI. Reproduce locally with --cpu-throttle 2.
```

## 4. Checks

Each check has a threshold and prints only when it trips, with the evidence
and one concrete next step. Thresholds are first guesses and have to be tuned
against real suites with before/after data before release.

1. **Accumulating listeners or nodes.** Sample `JSEventListeners` and `Nodes`
   after each chunk. Warn if listeners grow more than ~3x from the first chunk
   to the last, or keep growing linearly. If possible, name the event types
   that grow (CDP `DOMDebugger.getEventListeners` on `window` at start and
   end); that is what pointed at the offending tag.
2. **Tests slowing down over the run.** Fit duration against run order for
   tests that appear in both halves. Warn if the second half is >25% slower.
   Reported together with check 1 when both trip.
3. **Unmocked requests to the app's own API.** Requests that fail with
   `ERR_CONNECTION_REFUSED` (or similar) to the app's origin or API base,
   attributed to the running test by wall clock: record `Date.now()` in the
   in-page `onStart` / `onPass` / `onFail` and pass it back with the results.
   Tests run one at a time, so the attribution is exact. List top paths and
   tests. A natural follow-up for twd-js: an opt-in "fail on unmocked request"
   mode, for which this check provides the evidence.
4. **Third-party hosts.** Requests to hosts other than the dev server, grouped
   by host with request count and number of tests. Informational, plus a
   warning for hosts that fail.
5. **Global patching libraries.** `window.Zone` (zone.js) and others as they
   show up. Informational: a pointer, not proof of cost.
6. **Out-of-process iframes.** Peak count of `iframe` targets. Informational
   only until site isolation shows a measured effect.
7. **Retried and first-attempt failures.** The rate, and which tests are
   repeat offenders. Under `--repeat` this is the existing Flaky list, so the
   check only adds the rate.
8. **Machine.** `os.cpus().length`, `process.env.CI` and the throttle in use.
   On CI with ≤2 cores, suggest reproducing with `--cpu-throttle 2` and
   splitting across jobs with `--shard` rather than running browser contexts
   in parallel on that runner.

## 5. Combining with other flags

- **`--repeat`: allowed.** Both are debugging flags and they answer different
  questions: `--repeat` says *which* tests are flaky, `--diagnose` says *why*
  the suite is slow or unstable. `--repeat` reloads the page between rounds,
  so the page-level signals reset each round:
  - checks 1 and 2 are computed **per round** and reported for the worst
    round, since a reload clears listeners and nodes;
  - checks 3 and 4 accumulate across rounds, attributed by registration
    index (test ids are random per page load, the same join `--repeat` uses);
  - check 7 reuses the Flaky list.
- **`--shard`: allowed.** Each shard writes its own `diagnosis` block; `merge`
  sums the request counts and keeps the per-shard listener and slowdown
  results, since those are per-browser.
- **`--record`: open question.** The screencast and ffmpeg add CPU load that
  distorts checks 1, 2 and 8. Either refuse the combination or mark the timing
  checks as unreliable while recording.

## 6. Out of scope

- **`puppeteerArgs` replacing the defaults is a bug, not a check.** A
  `puppeteerArgs` array in `twd.config.json` replaces the default one (shallow
  merge in `src/config.js`), so adding one flag silently drops `--no-sandbox`.
  Fix the merge instead of diagnosing it. Tracked separately.
- **Reading the CI workflow and `index.html`.** Checks such as "Puppeteer
  cache keyed with `restore-keys`" or "third-party script without a
  `navigator.webdriver` guard" are heuristics tied to each project's setup
  and prone to false positives. Revisit as a separate `twd-cli doctor`
  subcommand only if users ask for it.

## 7. Where to start

1. Checks 3, 4 and 8: requests and machine. Smallest change, clearest win.
2. Checks 1 and 2: one `page.metrics()` per chunk plus a regression over the
   per-test durations twd-cli already has.
3. The informational checks (5, 6, 7).

## 8. Open questions

- Flag (`--diagnose`) vs config (`"diagnose": true`) vs an always-on light
  version (checks 1 and 3 are nearly free). Leaning: flag first, measure its
  overhead, then decide whether the light checks can be on by default.
- Should the in-page part (request attribution, listener breakdown) live in
  twd-js so the sidebar can show it too? Keep it in twd-cli first.
- `--record` combination (section 5).
- Thresholds need data from at least two real suites before release.
