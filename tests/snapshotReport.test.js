import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearFailureCaptures, listFailureCaptures } from '../src/snapshotReport.js';

let root;
let snapshotDir;

// A tiny but real PNG header, so the bytes that reach the data URI are not empty.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'twd-snap-report-'));
  snapshotDir = path.join(root, '__twd_snapshots__');
  fs.mkdirSync(snapshotDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const addFailure = (name) =>
  fs.writeFileSync(path.join(snapshotDir, `${name}.failed.png`), PNG_BYTES);

describe('listFailureCaptures', () => {
  it('lists captures by snapshot name, sorted', () => {
    addFailure('landing');
    addFailure('checkout');
    expect(listFailureCaptures(snapshotDir)).toEqual([
      { name: 'checkout', path: path.join(snapshotDir, 'checkout.failed.png') },
      { name: 'landing', path: path.join(snapshotDir, 'landing.failed.png') },
    ]);
  });

  it('ignores the committed references', () => {
    fs.writeFileSync(path.join(snapshotDir, 'landing.snap'), 'hash');
    expect(listFailureCaptures(snapshotDir)).toEqual([]);
  });

  it('is empty when the directory does not exist', () => {
    expect(listFailureCaptures(path.join(root, 'nope'))).toEqual([]);
  });
});

describe('clearFailureCaptures', () => {
  it('removes stale captures so the report only shows this run', () => {
    // twd-js overwrites a capture on failure but never deletes one when the
    // snapshot later passes, so without the sweep a fixed layout keeps showing.
    addFailure('landing');
    addFailure('checkout');

    expect(clearFailureCaptures(snapshotDir)).toBe(2);
    expect(listFailureCaptures(snapshotDir)).toEqual([]);
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
