# Reproducing CI-only timing flakes

A test that passes on your machine and fails on a CI runner is often a race
that a fast CPU always wins. `--cpu-throttle <rate>` slows the browser's CPU
down that many times, using Chrome's own CPU throttling, so the slow side of
the race gets its chance to show up locally:

```bash
npx twd-cli run --cpu-throttle 6 --test "checkout flow"
```

For a CI job that always runs slowed, set `"cpuThrottle": 4` in
`twd.config.json`. The flag overrides it, and `--cpu-throttle 1` runs that
config at full speed. A throttled run says so before it navigates and again in
the run-complete block, so a slow or red run is not read as an ordinary one:

```
CPU throttling: 6x (the browser runs 6 times slower; the dev server does not).
...
--- Run complete ---
  Passed: 71 | Failed: 0 | Skipped: 0
  Duration: 0.9s
  CPU throttle: 6x
```

Notes:

- **It raises the odds of hitting a race; it does not reproduce one every
  time.** Run it in a loop before concluding anything, in either direction:
  ```bash
  for i in $(seq 10); do
    npx twd-cli run --cpu-throttle 6 --test "checkout flow" --no-report > /dev/null && echo pass || echo FAIL
  done
  ```
- **Turn retries off while you hunt.** The default `retryCount` of `2` gives a
  failed test a second attempt, and a flake that passes on the second attempt
  is exactly what you are looking for. `retryCount` counts attempts, so
  `"retryCount": 1` means no retry. A test that only passed on a retry is
  listed under `Retried` in the run-complete block.
- **Only the browser is slowed.** The dev server, and anything else outside
  the page, runs at full speed.
- **It is slower, so it is not a default.** How much slower depends on how
  much of the suite is CPU work rather than waiting. The page load is
  throttled too, so a heavy app may need a higher `timeout` (the wait for the
  TWD sidebar) or `protocolTimeout` at high rates.
- A rate below `1` is refused before the browser launches, whether it comes
  from the flag or from `twd.config.json`.
