# Layout snapshots (beta)

`twd-js` 1.10.0 adds `twd.matchLayout`, which watches the **geometry** of a page
and fails when it moves. It is off in the browser sidebar on purpose, because
the sidebar resizes the page and a developer's window is an arbitrary size, so
**twd-cli is where a layout snapshot is actually decided.**

```bash
# Compare against the committed references
npx twd-cli run

# Accept the current layout as the new reference
npx twd-cli run --update-snapshots

# A missing reference is a failure, never created
npx twd-cli run --ci
```

## The two flags are separate on purpose

| Flag | What it does |
|------|--------------|
| `--update-snapshots` | Rewrites references that already exist. Without it, a changed layout fails, which is the point |
| `--ci` | Forbids *creating* a reference. Without it, a brand new test writes its own baseline on the first CI run and passes forever, and nobody finds out |

They close two different holes, which is why they are two flags rather than one
mode. `--ci` outranks `--update-snapshots`: both set, with no reference on disk,
is a failure and not a write.

## Seeing what changed

A failure writes `<name>.failed.png` next to the reference: your page as it
rendered, with the rows that diverged boxed in red. In CI the machine that
produced it is gone by the time anyone looks, so every capture also appears
embedded in the [run report](../README.md#run-report)'s **`.twd/report/index.html`**.

One file, one artifact, opens in any browser:

```yaml
- name: Upload the run report
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: layout-snapshots
    path: .twd/report
```

Captures from earlier runs are cleared before each run, so the report only ever
shows failures from the run you are looking at. The committed `.snap` references
next to them are never touched.

## Two things to know

**The viewport changed.** twd-cli now sets an explicit viewport on every run
(`1280x800` by default), not just when recording. Before, a normal run inherited
Puppeteer's implicit size. A test that happened to depend on the old size can
start behaving differently. Set `viewport` in `twd.config.json` to pin your own.

**`snapshotDir` has to match the Vite plugin.** twd-cli and the `twdSnapshot`
plugin are separate processes that never talk, so the directory is configured
twice. If the report comes out empty when you expected failures, this is the
first thing to check.
