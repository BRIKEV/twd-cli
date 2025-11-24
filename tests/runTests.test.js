import { describe, it } from "vitest";
import { runTests } from "../src/index.js";

describe("runTests", () => {
  it("should run tests and return failure status", async () => {
    const hasFailures = await runTests();
  });
});
