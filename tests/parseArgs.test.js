import { describe, it, expect } from "vitest";
import { parseRunArgs } from "../src/parseArgs.js";

describe("parseRunArgs", () => {
  it("returns empty filters when no args", () => {
    expect(parseRunArgs([])).toEqual({ testFilters: [] });
  });

  it("parses a single --test <value>", () => {
    expect(parseRunArgs(['--test', 'shows error'])).toEqual({
      testFilters: ['shows error'],
    });
  });

  it("parses repeated --test flags in order", () => {
    expect(parseRunArgs(['--test', 'Login', '--test', 'Signup'])).toEqual({
      testFilters: ['Login', 'Signup'],
    });
  });

  it("parses the --test=<value> form", () => {
    expect(parseRunArgs(['--test=Login'])).toEqual({
      testFilters: ['Login'],
    });
  });

  it("ignores a trailing --test with no value", () => {
    expect(parseRunArgs(['--test'])).toEqual({ testFilters: [] });
  });

  it("ignores unknown tokens", () => {
    expect(parseRunArgs(['--verbose', '--test', 'Login'])).toEqual({
      testFilters: ['Login'],
    });
  });
});
