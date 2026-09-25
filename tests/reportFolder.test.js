import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanReportDir, copySnapshotCaptures, loadSnapshotImages, writeReportFolder,
  readReport, rebaseShardArtifacts, DEFAULT_REPORT_DIR,
} from '../src/reportFiles.js';
import { runMerge } from '../src/mergeCommand.js';
import { report } from './reportFixtures.js';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'twd-report-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const touch = (rel, body = 'x') => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

describe('DEFAULT_REPORT_DIR', () => {
  it('is .twd/report', () => {
    expect(DEFAULT_REPORT_DIR).toBe('./.twd/report');
  });
});

describe('cleanReportDir', () => {
  it('removes only the entries twd-cli owns', () => {
    for (const f of ['run.json', 'index.html', 'summary.md', 'coverage.json', 'recordings/a.mp4', 'snapshots/b.png', 'package.json', 'src/app.js']) touch(f);
    cleanReportDir(root);
    expect(fs.readdirSync(root).sort()).toEqual(['package.json', 'src']);
  });

  it('keeps the directory itself', () => {
    cleanReportDir(root);
    expect(fs.existsSync(root)).toBe(true);
  });

  it('is a no-op for a missing directory', () => {
    expect(() => cleanReportDir(path.join(root, 'nope'))).not.toThrow();
  });

  it('removes shard-* folders a previous merge left', () => {
    touch('shard-2/recordings/a.mp4');
    touch('shared/keep.txt');
    cleanReportDir(root);
    expect(fs.readdirSync(root)).toEqual(['shared']);
  });
});

describe('copySnapshotCaptures', () => {
  it('copies captures into snapshots/ and returns report-relative paths', () => {
    touch('src/form.failed.png', 'png');
    const out = path.join(root, 'report');
    const snapshots = copySnapshotCaptures([{ name: 'form', path: path.join(root, 'src/form.failed.png') }], out);
    expect(snapshots).toEqual([{ name: 'form', file: 'snapshots/form.failed.png' }]);
    expect(fs.readFileSync(path.join(out, 'snapshots/form.failed.png'), 'utf8')).toBe('png');
  });

  it('skips a capture that cannot be copied', () => {
    expect(copySnapshotCaptures([{ name: 'gone', path: path.join(root, 'nope.png') }], root)).toEqual([]);
  });
});

describe('writeReportFolder / readReport', () => {
  it('writes run.json and the requested views', () => {
    const paths = writeReportFolder(root, report(), { formats: ['html', 'markdown'] });
    expect(fs.existsSync(paths.reportPath)).toBe(true);
    expect(fs.readFileSync(paths.htmlPath, 'utf8')).toContain('<!doctype html>');
    expect(fs.readFileSync(paths.markdownPath, 'utf8')).toContain('### ✅ TWD');
  });

  it('writes only run.json when no formats are requested', () => {
    const paths = writeReportFolder(root, report(), { formats: [] });
    expect(paths.htmlPath).toBeNull();
    expect(fs.readdirSync(root)).toEqual(['run.json']);
  });

  it('writes coverage compactly when given', () => {
    writeReportFolder(root, report(), { coverage: { a: 1 } });
    expect(fs.readFileSync(path.join(root, 'coverage.json'), 'utf8')).toBe('{"a":1}');
  });

  it('embeds snapshot images in the HTML', () => {
    touch('snapshots/form.failed.png', 'png');
    writeReportFolder(root, report({ snapshots: [{ name: 'form', file: 'snapshots/form.failed.png' }] }), { formats: ['html'] });
    expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toContain('data:image/png;base64,');
  });

  it('reads a report from its folder or its file', () => {
    writeReportFolder(root, report());
    expect(readReport(root).report.outcome).toBe('passed');
    expect(readReport(path.join(root, 'run.json')).dir).toBe(root);
  });

  it('explains a missing report', () => {
    expect(() => readReport(root)).toThrow(/No report found at .*run\.json/);
  });

  it('refuses another schema version', () => {
    touch('run.json', JSON.stringify({ schemaVersion: 2 }));
    expect(() => readReport(root)).toThrow(/schema v2.*reads v3/);
  });
});

describe('loadSnapshotImages', () => {
  it('maps each readable file to a data URI', () => {
    touch('snapshots/a.failed.png', 'png');
    const images = loadSnapshotImages(root, [
      { name: 'a', file: 'snapshots/a.failed.png' },
      { name: 'b', file: 'snapshots/b.failed.png' },
    ]);
    expect(Object.keys(images)).toEqual(['snapshots/a.failed.png']);
    expect(images['snapshots/a.failed.png']).toMatch(/^data:image\/png;base64,/);
  });
});

describe('rebaseShardArtifacts', () => {
  it('copies artifacts under a prefix and rewrites their paths', () => {
    touch('shard/recordings/run.mp4', 'v');
    touch('shard/snapshots/f.failed.png', 'p');
    const shardReport = report({
      tests: [{ id: 't1', status: 'fail', recording: 'recordings/run.mp4' }],
      recordings: [{ file: 'recordings/run.mp4', bytes: 1 }],
      snapshots: [{ name: 'f', file: 'snapshots/f.failed.png' }],
    });
    const out = path.join(root, 'merged');
    const rebased = rebaseShardArtifacts(shardReport, path.join(root, 'shard'), out, 'shard-1');
    expect(rebased.tests[0].recording).toBe('shard-1/recordings/run.mp4');
    expect(rebased.shards[0].recordings[0].file).toBe('shard-1/recordings/run.mp4');
    expect(rebased.snapshots[0].file).toBe('shard-1/snapshots/f.failed.png');
    expect(fs.existsSync(path.join(out, 'shard-1/recordings/run.mp4'))).toBe(true);
  });
});

describe('runMerge into its own input folder', () => {
  it('reads before it cleans, so merging .twd/report onto itself works', () => {
    touch('snapshots/f.failed.png', 'p');
    const shardReport = report({ snapshots: [{ name: 'f', file: 'snapshots/f.failed.png' }] });
    writeReportFolder(root, shardReport);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      runMerge({ dir: '.', out: '.' });
    } finally {
      process.chdir(cwd);
    }
    expect(JSON.parse(fs.readFileSync(path.join(root, 'run.json'), 'utf8')).tests).toHaveLength(3);
    expect(fs.existsSync(path.join(root, 'shard-1/snapshots/f.failed.png'))).toBe(true);
    expect(fs.existsSync(`${root}.tmp-merge`)).toBe(false);
  });

  it('removes the sibling staging folder even when the merge throws', () => {
    touch('snapshots/f.failed.png', 'p');
    const shardReport = report({
      shard: { index: 1, total: 2 },
      snapshots: [{ name: 'f', file: 'snapshots/f.failed.png' }],
    });
    writeReportFolder(root, shardReport);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(() => runMerge({ dir: '.', out: '.' })).toThrow(/Missing shard report/);
    } finally {
      process.chdir(cwd);
    }
    expect(fs.existsSync(`${root}.tmp-merge`)).toBe(false);
  });
});
