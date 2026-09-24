import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

// These spawn the real bin. Every case below returns before the dynamic
// import of src/index.js, so no browser is ever launched — a case that did
// reach the run would fail on exit code alone, since there is no dev server.
const BIN = fileURLToPath(new URL("../bin/twd-cli.js", import.meta.url));

function cli(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

describe("twd-cli help", () => {
  it.each([
    [[]],
    [["help"]],
    [["--help"]],
    [["-h"]],
  ])("%j prints global usage on stdout and exits 0", async (args) => {
    const { code, stdout, stderr } = await cli(...args);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/twd-cli run/);
    expect(stdout).toMatch(/twd-cli merge/);
  });

  it("run --help prints run usage, exits 0 and does not start a run", async () => {
    const { code, stdout, stderr } = await cli("run", "--help");
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/--changed-since/);
    expect(stdout).toMatch(/--update-snapshots/);
    expect(stdout).not.toMatch(/--out/);
  });

  it("run -h is the same as run --help", async () => {
    const { code, stdout } = await cli("run", "-h");
    expect(code).toBe(0);
    expect(stdout).toMatch(/--changed-since/);
  });

  it("--help wins wherever it appears among run flags", async () => {
    const { code, stdout, stderr } = await cli("run", "--test", "foo", "--help");
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/--changed-since/);
  });

  it("merge --help prints merge usage and exits 0", async () => {
    const { code, stdout, stderr } = await cli("merge", "--help");
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/--out/);
    expect(stdout).not.toMatch(/--record/);
  });

  it("help <command> prints that command's usage", async () => {
    const { code, stdout } = await cli("help", "merge");
    expect(code).toBe(0);
    expect(stdout).toMatch(/--out/);
    expect(stdout).not.toMatch(/--record/);
  });

  it("run with an unknown flag refuses to run: stderr names it, exit 1", async () => {
    const { code, stdout, stderr } = await cli("run", "--tests", "foo");
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/unknown option --tests/);
    expect(stderr).toMatch(/Did you mean --test\?/);
  });

  it("an unknown command is a usage error: stderr, exit 1", async () => {
    const { code, stdout, stderr } = await cli("bogus");
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/unknown command/i);
    expect(stderr).toMatch(/bogus/);
    expect(stderr).toMatch(/twd-cli run/);
  });
});
