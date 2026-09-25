// Help text, one block per command. Plain template strings on purpose: the
// spec rules out a formatting library, and these are read by people and by
// agents pasting `--help` output into a prompt, so wrapping is done by hand.
//
// Every flag in RUN_FLAGS / MERGE_FLAGS (src/parseArgs.js) has to appear in
// its command's block. tests/usage.test.js derives the expected set from those
// lists, so adding a flag to the parser without a help line fails the suite.

const HEADER = `twd-cli - Test runner for TWD tests

Options that take a value accept both \`--flag value\` and \`--flag=value\`.`;

export function globalUsage() {
  return `
${HEADER}

Usage:
  npx twd-cli run [options]        Run the TWD tests registered in the app
                                   served at the url in twd.config.json
  npx twd-cli merge <dir> [--out]  (beta) Merge shard reports from <dir> into
                                   one report, exit 1 if the run failed
  npx twd-cli report [<dir>]       Print a saved report as markdown, html or json
  npx twd-cli <command> --help     Every option for that command

Examples:
  npx twd-cli run
  npx twd-cli run --test "Login" --test "Signup"
  npx twd-cli run --record --changed-since origin/main
  npx twd-cli run --shard 2/4
  npx twd-cli merge .twd/shards
  npx twd-cli report --format markdown >> "$GITHUB_STEP_SUMMARY"

Create a twd.config.json file in your project root to customize settings.
`;
}

export function runUsage() {
  return `
${HEADER}

Usage:
  npx twd-cli run [options]

Launches a headless browser against the url in twd.config.json (default
http://localhost:5173), runs every registered test and exits 1 if any failed.
The dev server has to be running already.

Filtering:
  --test "<name>"        Run only tests whose "suite > test" path contains
                         <name> (case-insensitive). Repeatable; multiple
                         --test values are OR'd. Matching nothing exits 1 —
                         a typo must not look like a pass.
  --changed-since <ref>  Run only the tests this branch added or changed since
                         <ref>, worked out from git. Unions with --test. A
                         branch that changed no tests prints one line and
                         exits 0 — an empty result is not a failure. Needs the
                         base branch in the clone: in GitHub Actions set
                         fetch-depth: 0 on actions/checkout.

Sharding (beta):
  --shard <i>/<n>        Run slice i of n. Each shard discovers the whole
                         suite and takes every nth test, so the count never
                         has to be known in advance. Implies a report.
                         Which tests land in which shard may change.

Report:
  Every run writes run.json, index.html and summary.md to ./.twd/report.
  --report-dir <path>    Where to write the report (default ./.twd/report)
  --no-report            Write no report, and leave an existing one alone

Layout snapshots (beta):
  --update-snapshots     Rewrite layout references that already exist
  --ci                   Refuse to create a missing reference; fail instead.
                         Outranks --update-snapshots when both are set.

Recording:
  --record               Record the run to a video file (requires ffmpeg 8+)
  --record-dir <path>    Output directory (default <report dir>/recordings)
  --record-speed <n>     Playback speed, e.g. 0.5 for half speed
  --record-pace <ms>     Slow the run itself (default 300). 0 disables pacing

  The last three only set values. Recording still has to be turned on with
  --record or "record": { "enabled": true } in twd.config.json.

Examples:
  npx twd-cli run --test "shows error"
  npx twd-cli run --test "Login" --test "Signup"
  npx twd-cli run --record --changed-since origin/main
  npx twd-cli run --shard 2/4

Create a twd.config.json file in your project root to customize settings.
`;
}

export function mergeUsage() {
  return `
${HEADER}

Usage:
  npx twd-cli merge <dir> [options]

(beta) Merges the shard reports found in <dir> into one report and exits 1 if
any shard recorded a failure. <dir> is the first positional argument.

Options:
  --out <path>           Where to write the merged report folder
                         (default ./.twd/report)

Examples:
  npx twd-cli merge .twd/shards
  npx twd-cli merge .twd/shards --out merged
`;
}

export function reportUsage() {
  return `
${HEADER}

Usage:
  npx twd-cli report [<dir|run.json>] [options]

Prints a saved run report to stdout. <dir> defaults to ./.twd/report. Exits 0
when it rendered, 1 when the report is missing or unreadable. The run's
verdict belongs to \`run\` and \`merge\`, not to this command.

Options:
  --format <f>           markdown (default), html or json

Examples:
  npx twd-cli report
  npx twd-cli report .twd/report --format markdown >> "$GITHUB_STEP_SUMMARY"
  npx twd-cli report --format html > report.html
`;
}
