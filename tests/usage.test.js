import { describe, it, expect } from "vitest";
import { globalUsage, runUsage, mergeUsage, reportUsage } from "../src/usage.js";
import { RUN_FLAGS, MERGE_FLAGS, REPORT_FLAGS } from "../src/parseArgs.js";

describe("globalUsage", () => {
  it("names both commands and the help flag", () => {
    const text = globalUsage();
    expect(text).toMatch(/twd-cli run/);
    expect(text).toMatch(/twd-cli merge/);
    expect(text).toMatch(/--help/);
  });
});

it("globalUsage names the report command", () => {
  expect(globalUsage()).toMatch(/twd-cli report/);
});

describe("runUsage", () => {
  it("names every flag parseRunArgs handles", () => {
    // Derived from the parser's own list rather than hard-coded here, so a flag
    // added to parseRunArgs without a help line fails this test.
    const text = runUsage();
    for (const flag of RUN_FLAGS) {
      expect(text, `${flag} missing from run --help`).toContain(flag);
    }
  });

  it("says once that both value forms are accepted", () => {
    expect(runUsage()).toMatch(/--flag=value/);
  });

  it("does not describe merge", () => {
    expect(runUsage()).not.toMatch(/--out/);
  });
});

describe("mergeUsage", () => {
  it("names every flag parseMergeArgs handles", () => {
    const text = mergeUsage();
    for (const flag of MERGE_FLAGS) {
      expect(text, `${flag} missing from merge --help`).toContain(flag);
    }
  });

  it("does not describe run", () => {
    expect(mergeUsage()).not.toMatch(/--record/);
  });
});

describe("reportUsage", () => {
  it("names every flag parseReportArgs handles", () => {
    const text = reportUsage();
    for (const flag of REPORT_FLAGS) expect(text).toContain(flag);
  });
});
