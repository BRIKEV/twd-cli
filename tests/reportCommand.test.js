import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderReport } from '../src/reportCommand.js';
import { writeReportFolder } from '../src/reportFiles.js';
import { report } from './reportFixtures.js';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'twd-reportcmd-'));
  writeReportFolder(root, report());
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('renderReport', () => {
  it('renders markdown by default', () => {
    expect(renderReport({ input: root })).toMatch(/^### ✅ TWD: 3 passed/);
  });
  it('renders html', () => {
    expect(renderReport({ input: root, format: 'html' })).toMatch(/^<!doctype html>/);
  });
  it('renders json', () => {
    expect(JSON.parse(renderReport({ input: path.join(root, 'run.json'), format: 'json' })).outcome).toBe('passed');
  });
  it('throws a readable error for a missing report', () => {
    expect(() => renderReport({ input: path.join(root, 'nope') })).toThrow(/No report found/);
  });
});
