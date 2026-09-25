import { describe, it, expect } from "vitest";
import { parseRunArgs, parseMergeArgs, parseReportArgs } from "../src/parseArgs.js";

describe("parseRunArgs", () => {
  it("returns empty filters when no args", () => {
    expect(parseRunArgs([])).toEqual({ testFilters: [], changedSince: null, record: {}, shard: null, reportDir: null, noReport: false, updateSnapshots: false, ci: false });
  });

  it("parses a single --test <value>", () => {
    expect(parseRunArgs(['--test', 'shows error'])).toEqual({
      testFilters: ['shows error'],
      record: {},
      changedSince: null,
      shard: null,
      reportDir: null,
      noReport: false,
      updateSnapshots: false,
      ci: false,
    });
  });

  it("parses repeated --test flags in order", () => {
    expect(parseRunArgs(['--test', 'Login', '--test', 'Signup'])).toEqual({
      testFilters: ['Login', 'Signup'],
      record: {},
      changedSince: null,
      shard: null,
      reportDir: null,
      noReport: false,
      updateSnapshots: false,
      ci: false,
    });
  });

  it("parses the --test=<value> form", () => {
    expect(parseRunArgs(['--test=Login'])).toEqual({
      testFilters: ['Login'],
      record: {},
      changedSince: null,
      shard: null,
      reportDir: null,
      noReport: false,
      updateSnapshots: false,
      ci: false,
    });
  });

  it("ignores a trailing --test with no value", () => {
    expect(parseRunArgs(['--test'])).toEqual({ testFilters: [], changedSince: null, record: {}, shard: null, reportDir: null, noReport: false, updateSnapshots: false, ci: false });
  });

  it("ignores positional tokens", () => {
    // Only `--`-prefixed strays are rejected. A bare word is not a flag the
    // caller believes they set, so it keeps its historical treatment.
    expect(parseRunArgs(['extra', '--test', 'Login']).testFilters).toEqual(['Login']);
  });

  it("returns an empty record object when no record flags are present", () => {
    expect(parseRunArgs(['--test', 'Login']).record).toEqual({});
  });

  it("parses --record", () => {
    expect(parseRunArgs(['--record']).record).toEqual({ enabled: true });
  });

  it("parses --record-dir <value> and the = form", () => {
    expect(parseRunArgs(['--record-dir', './clips']).record).toEqual({ dir: './clips' });
    expect(parseRunArgs(['--record-dir=./clips']).record).toEqual({ dir: './clips' });
  });

  it("parses --record-speed as a number, both forms", () => {
    expect(parseRunArgs(['--record-speed', '0.5']).record).toEqual({ speed: 0.5 });
    expect(parseRunArgs(['--record-speed=2']).record).toEqual({ speed: 2 });
  });

  it("ignores a non-numeric or non-positive --record-speed", () => {
    // Unlike pace, 0 stays rejected here: speed is a playback multiplier, so a
    // speed of 0 is meaningless rather than "off".
    expect(parseRunArgs(['--record-speed', 'slow']).record).toEqual({});
    expect(parseRunArgs(['--record-speed', '0']).record).toEqual({});
    expect(parseRunArgs(['--record-speed', '-1']).record).toEqual({});
  });

  it("ignores trailing record flags with no value", () => {
    expect(parseRunArgs(['--record-dir']).record).toEqual({});
    expect(parseRunArgs(['--record-speed']).record).toEqual({});
  });

  it("combines record flags with --test filters", () => {
    expect(parseRunArgs(['--record', '--test', 'checkout', '--record-speed=0.5'])).toEqual({
      testFilters: ['checkout'],
      record: { enabled: true, speed: 0.5 },
      changedSince: null,
      shard: null,
      reportDir: null,
      noReport: false,
      updateSnapshots: false,
      ci: false,
    });
  });

  it("parses --record-pace as a number, both forms", () => {
    expect(parseRunArgs(['--record-pace', '500']).record).toEqual({ pace: 500 });
    expect(parseRunArgs(['--record-pace=250']).record).toEqual({ pace: 250 });
  });

  it("ignores a non-numeric or negative --record-pace", () => {
    expect(parseRunArgs(['--record-pace', 'slow']).record).toEqual({});
    expect(parseRunArgs(['--record-pace', '-1']).record).toEqual({});
  });

  it("accepts --record-pace 0, the documented way to turn pacing off", () => {
    // 0 is a meaningful value here, not a rejected input. DEFAULT_RECORD.pace
    // says "Set 0 to disable", and the recording docs give this exact command
    // as the way to get the fastest possible recorded run. Grouping it with
    // negatives and non-numerics is what made the flag a silent no-op.
    expect(parseRunArgs(['--record-pace', '0']).record).toEqual({ pace: 0 });
    expect(parseRunArgs(['--record-pace=0']).record).toEqual({ pace: 0 });
  });

  it("ignores a trailing --record-pace with no value", () => {
    expect(parseRunArgs(['--record-pace']).record).toEqual({});
  });

  it("combines --record-pace with --record and a test filter", () => {
    expect(parseRunArgs(['--record', '--test', 'checkout', '--record-pace=500'])).toEqual({
      testFilters: ['checkout'],
      record: { enabled: true, pace: 500 },
      changedSince: null,
      shard: null,
      reportDir: null,
      noReport: false,
      updateSnapshots: false,
      ci: false,
    });
  });

});

describe('parseRunArgs shard and report flags', () => {
  it('parses --shard in both forms', () => {
    expect(parseRunArgs(['--shard', '2/4']).shard).toEqual({ index: 2, total: 4 });
    expect(parseRunArgs(['--shard=3/4']).shard).toEqual({ index: 3, total: 4 });
  });

  it('throws on an invalid --shard instead of ignoring it', () => {
    expect(() => parseRunArgs(['--shard', '5/4'])).toThrow(/Invalid --shard/);
    expect(() => parseRunArgs(['--shard=abc'])).toThrow(/Invalid --shard/);
  });

  it('throws on a trailing --shard with no value', () => {
    expect(() => parseRunArgs(['--shard'])).toThrow(/Invalid --shard/);
  });

  it('parses --report-dir in both forms', () => {
    expect(parseRunArgs(['--report-dir', './out']).reportDir).toBe('./out');
    expect(parseRunArgs(['--report-dir=./out']).reportDir).toBe('./out');
  });

  it('ignores a trailing --report-dir with no value', () => {
    expect(parseRunArgs(['--report-dir']).reportDir).toBeNull();
  });

  it('combines --shard with --test filters and record flags', () => {
    expect(parseRunArgs(['--shard', '2/4', '--test', 'Login', '--record'])).toEqual({
      testFilters: ['Login'],
      changedSince: null,
      record: { enabled: true },
      shard: { index: 2, total: 4 },
      reportDir: null,
      noReport: false,
      updateSnapshots: false,
      ci: false,
    });
  });

  it("defaults both snapshot flags to false", () => {
    const { updateSnapshots, ci } = parseRunArgs([]);
    expect(updateSnapshots).toBe(false);
    expect(ci).toBe(false);
  });

  it("parses --update-snapshots", () => {
    expect(parseRunArgs(['--update-snapshots']).updateSnapshots).toBe(true);
  });

  it("parses --ci", () => {
    expect(parseRunArgs(['--ci']).ci).toBe(true);
  });

  it("parses both snapshot flags together", () => {
    // They are two different holes and both can be open at once. twd-js decides
    // the precedence; the CLI only reports what was asked for.
    const { updateSnapshots, ci } = parseRunArgs(['--update-snapshots', '--ci']);
    expect(updateSnapshots).toBe(true);
    expect(ci).toBe(true);
  });

  it("leaves the other flags alone when snapshot flags are present", () => {
    const result = parseRunArgs(['--ci', '--test', 'Login', '--report-dir', './out']);
    expect(result.testFilters).toEqual(['Login']);
    expect(result.reportDir).toBe('./out');
    expect(result.ci).toBe(true);
  });

});

describe('parseRunArgs --no-report', () => {
  it('defaults to false', () => {
    expect(parseRunArgs([]).noReport).toBe(false);
  });
  it('sets noReport', () => {
    expect(parseRunArgs(['--no-report']).noReport).toBe(true);
  });
});

describe('parseRunArgs --changed-since', () => {
  it('parses --changed-since in both forms', () => {
    expect(parseRunArgs(['--changed-since', 'origin/main']).changedSince).toBe('origin/main');
    expect(parseRunArgs(['--changed-since=origin/main']).changedSince).toBe('origin/main');
  });

  it('defaults to null when the flag is absent', () => {
    expect(parseRunArgs([]).changedSince).toBeNull();
  });

  it('ignores a trailing --changed-since with no value', () => {
    expect(parseRunArgs(['--changed-since']).changedSince).toBeNull();
  });

  it('does not swallow the flag that follows a valueless --changed-since', () => {
    const result = parseRunArgs(['--changed-since', '--record']);
    // A ref never starts with `--`, so treating the next flag as the value
    // would both lose --record and hand git something it cannot resolve.
    expect(result.changedSince).toBeNull();
    expect(result.record.enabled).toBe(true);
  });

  it('accepts a ref containing a slash, a dot or a dash', () => {
    expect(parseRunArgs(['--changed-since', 'origin/release-1.2']).changedSince)
      .toBe('origin/release-1.2');
  });

  it('composes with --test rather than replacing it', () => {
    const result = parseRunArgs(['--changed-since', 'main', '--test', 'Login']);

    expect(result.changedSince).toBe('main');
    expect(result.testFilters).toEqual(['Login']);
  });
});

describe('parseRunArgs unknown options', () => {
  it('refuses an unknown --flag instead of dropping it', () => {
    // The whole reason `run --help` ran the suite: a token no branch claimed
    // was silently ignored, so a typo ran the entire suite with a filter the
    // caller believed they had set.
    expect(() => parseRunArgs(['--verbose', '--test', 'Login']))
      .toThrow(/unknown option --verbose/);
  });

  it('suggests the closest known flag', () => {
    expect(() => parseRunArgs(['--tests', 'foo'])).toThrow(/Did you mean --test\?/);
    expect(() => parseRunArgs(['--changed_since', 'main'])).toThrow(/Did you mean --changed-since\?/);
  });

  it('points at run --help', () => {
    expect(() => parseRunArgs(['--tests', 'foo'])).toThrow(/twd-cli run --help/);
  });

  it('names the flag without its =value', () => {
    let message;
    try { parseRunArgs(['--tests=foo']); } catch (e) { message = e.message; }
    expect(message).toMatch(/unknown option --tests\b/);
    expect(message).not.toMatch(/--tests=foo/);
  });

  it('lists every unknown flag, not only the first', () => {
    let message;
    try { parseRunArgs(['--foo', '--bar']); } catch (e) { message = e.message; }
    expect(message).toMatch(/--foo/);
    expect(message).toMatch(/--bar/);
  });

  it('offers no suggestion when nothing is close', () => {
    let message;
    try { parseRunArgs(['--frobnicate']); } catch (e) { message = e.message; }
    expect(message).toMatch(/unknown option --frobnicate/);
    expect(message).not.toMatch(/Did you mean/);
  });

  it('does not reject the value that follows an unknown flag', () => {
    // `--tests foo`: only --tests is reported. `foo` is a positional and
    // positionals are not the caller's mistake here.
    let message;
    try { parseRunArgs(['--tests', 'foo']); } catch (e) { message = e.message; }
    expect(message).not.toMatch(/\bfoo\b/);
  });
});

describe('parseMergeArgs unknown options', () => {
  it('refuses an unknown --flag and points at merge --help', () => {
    expect(() => parseMergeArgs(['.twd/shards', '--output', 'x']))
      .toThrow(/unknown option --output/);
    expect(() => parseMergeArgs(['.twd/shards', '--output', 'x']))
      .toThrow(/Did you mean --out\?/);
    expect(() => parseMergeArgs(['.twd/shards', '--output', 'x']))
      .toThrow(/twd-cli merge --help/);
  });

  it('still takes the first positional as the directory', () => {
    expect(parseMergeArgs(['.twd/shards', 'ignored']).dir).toBe('.twd/shards');
  });
});

describe('parseMergeArgs', () => {
  it('reads the directory as the first positional', () => {
    expect(parseMergeArgs(['.twd/shards'])).toEqual({ dir: '.twd/shards', out: null });
  });

  it('parses --out in both forms', () => {
    expect(parseMergeArgs(['.twd/shards', '--out', 'merged.json']))
      .toEqual({ dir: '.twd/shards', out: 'merged.json' });
    expect(parseMergeArgs(['.twd/shards', '--out=merged.json']))
      .toEqual({ dir: '.twd/shards', out: 'merged.json' });
  });

  it('returns a null dir when none is given', () => {
    expect(parseMergeArgs([])).toEqual({ dir: null, out: null });
    expect(parseMergeArgs(['--out=merged.json'])).toEqual({ dir: null, out: 'merged.json' });
  });

  it('takes only the first positional as the directory', () => {
    expect(parseMergeArgs(['a', 'b']).dir).toBe('a');
  });
});

describe('parseReportArgs', () => {
  it('defaults to markdown with no input', () => {
    expect(parseReportArgs([])).toEqual({ input: null, format: 'markdown' });
  });
  it('takes the first positional as input', () => {
    expect(parseReportArgs(['.twd/report', '--format', 'html'])).toEqual({ input: '.twd/report', format: 'html' });
  });
  it('accepts --format=json', () => {
    expect(parseReportArgs(['--format=json']).format).toBe('json');
  });
  it('refuses an unknown format', () => {
    expect(() => parseReportArgs(['--format', 'junit'])).toThrow(/unknown format "junit".*markdown, html, json/);
  });
  it('refuses an unknown option with a suggestion', () => {
    expect(() => parseReportArgs(['--formt', 'html'])).toThrow(/Did you mean --format\?/);
  });
});
