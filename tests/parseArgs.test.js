import { describe, it, expect } from "vitest";
import { parseRunArgs, parseMergeArgs } from "../src/parseArgs.js";

describe("parseRunArgs", () => {
  it("returns empty filters when no args", () => {
    expect(parseRunArgs([])).toEqual({ testFilters: [], record: {}, shard: null, reportDir: null });
  });

  it("parses a single --test <value>", () => {
    expect(parseRunArgs(['--test', 'shows error'])).toEqual({
      testFilters: ['shows error'],
      record: {},
      shard: null,
      reportDir: null,
    });
  });

  it("parses repeated --test flags in order", () => {
    expect(parseRunArgs(['--test', 'Login', '--test', 'Signup'])).toEqual({
      testFilters: ['Login', 'Signup'],
      record: {},
      shard: null,
      reportDir: null,
    });
  });

  it("parses the --test=<value> form", () => {
    expect(parseRunArgs(['--test=Login'])).toEqual({
      testFilters: ['Login'],
      record: {},
      shard: null,
      reportDir: null,
    });
  });

  it("ignores a trailing --test with no value", () => {
    expect(parseRunArgs(['--test'])).toEqual({ testFilters: [], record: {}, shard: null, reportDir: null });
  });

  it("ignores unknown tokens", () => {
    expect(parseRunArgs(['--verbose', '--test', 'Login'])).toEqual({
      testFilters: ['Login'],
      record: {},
      shard: null,
      reportDir: null,
    });
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
      shard: null,
      reportDir: null,
    });
  });

  it("parses --record-pace as a number, both forms", () => {
    expect(parseRunArgs(['--record-pace', '500']).record).toEqual({ pace: 500 });
    expect(parseRunArgs(['--record-pace=250']).record).toEqual({ pace: 250 });
  });

  it("ignores a non-numeric or non-positive --record-pace", () => {
    expect(parseRunArgs(['--record-pace', 'slow']).record).toEqual({});
    expect(parseRunArgs(['--record-pace', '0']).record).toEqual({});
    expect(parseRunArgs(['--record-pace', '-1']).record).toEqual({});
  });

  it("ignores a trailing --record-pace with no value", () => {
    expect(parseRunArgs(['--record-pace']).record).toEqual({});
  });

  it("combines --record-pace with --record and a test filter", () => {
    expect(parseRunArgs(['--record', '--test', 'checkout', '--record-pace=500'])).toEqual({
      testFilters: ['checkout'],
      record: { enabled: true, pace: 500 },
      shard: null,
      reportDir: null,
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
      record: { enabled: true },
      shard: { index: 2, total: 4 },
      reportDir: null,
    });
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
