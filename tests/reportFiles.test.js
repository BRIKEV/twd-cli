import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');

import fs from 'fs';
import {
  readShardReports,
  readShardCoverage,
  RUN_REPORT_FILE,
  COVERAGE_FILE,
} from '../src/reportFiles.js';

const report = { schemaVersion: 1, tests: [] };

describe('readShardReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // This is download-artifact's layout: one directory per artifact name.
  it('reads run.json from each child directory', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(RUN_REPORT_FILE));
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'twd-run-1', isDirectory: () => true },
      { name: 'twd-run-2', isDirectory: () => true },
      { name: 'notes.txt', isDirectory: () => false },
    ]);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(report));

    const found = readShardReports('.twd/shards');

    expect(found.map((f) => f.dir)).toEqual([
      '.twd/shards',
      '.twd/shards/twd-run-1',
      '.twd/shards/twd-run-2',
    ]);
    expect(found[0].report).toEqual(report);
  });

  it('skips child directories with no run.json', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('twd-run-1'));
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'twd-run-1', isDirectory: () => true },
      { name: 'empty', isDirectory: () => true },
    ]);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(report));

    expect(readShardReports('.twd/shards').map((f) => f.dir))
      .toEqual(['.twd/shards/twd-run-1']);
  });

  it('returns an empty array when the directory does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(readShardReports('.twd/nope')).toEqual([]);
  });

  it('explains which file failed to parse', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.readFileSync).mockReturnValue('{ not json');
    expect(() => readShardReports('.twd/shards')).toThrow(/run\.json/);
  });
});

describe('readShardCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the named coverage file from the shard directory', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{"/a.js":{}}');
    expect(readShardCoverage('.twd/shards/twd-run-1', COVERAGE_FILE)).toEqual({ '/a.js': {} });
  });

  it('returns null when the shard recorded no coverage file', () => {
    expect(readShardCoverage('.twd/shards/twd-run-1', null)).toBeNull();
    expect(fs.existsSync).not.toHaveBeenCalled();
  });

  // A shard whose coverage file is absent simply does not contribute; merge
  // reports the contributor count rather than failing.
  it('returns null when the file is missing on disk', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(readShardCoverage('.twd/shards/twd-run-1', COVERAGE_FILE)).toBeNull();
  });
});
