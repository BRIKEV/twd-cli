import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeSnapshotReport,
  clearFailureCaptures,
  SNAPSHOT_REPORT_FILE,
} from '../src/snapshotReport.js';

let root;
let snapshotDir;
let outDir;

// A tiny but real PNG header, so the bytes that reach the data URI are not empty.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'twd-snap-report-'));
  snapshotDir = path.join(root, '__twd_snapshots__');
  outDir = path.join(root, '.twd');
  fs.mkdirSync(snapshotDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const addFailure = (name) =>
  fs.writeFileSync(path.join(snapshotDir, `${name}.failed.png`), PNG_BYTES);

describe('writeSnapshotReport', () => {
  it('writes nothing when the snapshot directory does not exist', () => {
    // Not an error: it just means no snapshot ever ran here.
    const result = writeSnapshotReport(path.join(root, 'nope'), outDir);

    expect(result).toBeNull();
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it('writes nothing when there are no failures', () => {
    // A .snap on its own is a passing reference, not a failure.
    fs.writeFileSync(path.join(snapshotDir, 'landing.snap'), 'hash abcd');

    const result = writeSnapshotReport(snapshotDir, outDir);

    expect(result).toBeNull();
    expect(fs.existsSync(path.join(outDir, SNAPSHOT_REPORT_FILE))).toBe(false);
  });

  it('embeds every failure as a data URI in one self-contained file', () => {
    // Self-contained is the whole point: one artifact the reviewer opens,
    // instead of a zip of loose PNGs to match up by filename.
    addFailure('landing');
    addFailure('checkout');

    const result = writeSnapshotReport(snapshotDir, outDir);

    expect(result.count).toBe(2);
    const html = fs.readFileSync(result.reportPath, 'utf8');
    expect(html.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(html).toContain('landing');
    expect(html).toContain('checkout');
    expect(html).not.toContain('.failed.png"');
  });

  it('names each snapshot by its file, minus the .failed.png suffix', () => {
    addFailure('landing-mobile');

    const html = fs.readFileSync(writeSnapshotReport(snapshotDir, outDir).reportPath, 'utf8');

    expect(html).toContain('landing-mobile');
  });

  it('skips a file it cannot read and keeps the rest of the report', () => {
    // One unreadable file must not cost the reviewer the other nine. A
    // directory named like a PNG makes readFileSync throw EISDIR portably.
    addFailure('landing');
    fs.mkdirSync(path.join(snapshotDir, 'broken.failed.png'));

    const result = writeSnapshotReport(snapshotDir, outDir);

    expect(result.count).toBe(1);
    expect(result.skipped).toEqual(['broken.failed.png']);
    const html = fs.readFileSync(result.reportPath, 'utf8');
    expect(html).toContain('landing');
    expect(html).toContain('broken.failed.png');
  });

  it('returns null and does not throw when the output directory cannot be written', () => {
    // The report is a diagnostic aid. Failing the run because it could not be
    // written would turn it into a new failure mode of its own.
    addFailure('landing');
    const blocked = path.join(root, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');

    expect(() => writeSnapshotReport(snapshotDir, blocked)).not.toThrow();
    expect(writeSnapshotReport(snapshotDir, blocked)).toBeNull();
  });

  it('escapes a snapshot name so it cannot inject markup into the report', () => {
    addFailure('<img src=x onerror=alert(1)>');

    const html = fs.readFileSync(writeSnapshotReport(snapshotDir, outDir).reportPath, 'utf8');

    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img src=x onerror');
  });
});

describe('clearFailureCaptures', () => {
  it('removes stale captures so the report only shows this run', () => {
    // twd-js overwrites a capture on failure but never deletes one when the
    // snapshot later passes, so without the sweep a fixed layout keeps showing.
    addFailure('landing');
    addFailure('checkout');

    expect(clearFailureCaptures(snapshotDir)).toBe(2);
    expect(writeSnapshotReport(snapshotDir, outDir)).toBeNull();
  });

  it('never touches the committed .snap references next to them', () => {
    const reference = path.join(snapshotDir, 'landing.snap');
    fs.writeFileSync(reference, 'hash abcd');
    addFailure('landing');

    clearFailureCaptures(snapshotDir);

    expect(fs.existsSync(reference)).toBe(true);
    expect(fs.readFileSync(reference, 'utf8')).toBe('hash abcd');
  });

  it('is a no-op when the directory does not exist', () => {
    expect(clearFailureCaptures(path.join(root, 'nope'))).toBe(0);
  });
});
