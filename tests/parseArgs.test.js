import { describe, it, expect } from "vitest";
import { parseRunArgs } from "../src/parseArgs.js";

describe("parseRunArgs", () => {
  it("returns empty filters when no args", () => {
    expect(parseRunArgs([])).toEqual({ testFilters: [], record: {} });
  });

  it("parses a single --test <value>", () => {
    expect(parseRunArgs(['--test', 'shows error'])).toEqual({
      testFilters: ['shows error'],
      record: {},
    });
  });

  it("parses repeated --test flags in order", () => {
    expect(parseRunArgs(['--test', 'Login', '--test', 'Signup'])).toEqual({
      testFilters: ['Login', 'Signup'],
      record: {},
    });
  });

  it("parses the --test=<value> form", () => {
    expect(parseRunArgs(['--test=Login'])).toEqual({
      testFilters: ['Login'],
      record: {},
    });
  });

  it("ignores a trailing --test with no value", () => {
    expect(parseRunArgs(['--test'])).toEqual({ testFilters: [], record: {} });
  });

  it("ignores unknown tokens", () => {
    expect(parseRunArgs(['--verbose', '--test', 'Login'])).toEqual({
      testFilters: ['Login'],
      record: {},
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
    });
  });

});
