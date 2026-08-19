import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');

import fs from 'fs';
import {
  writeRunReport,
  readShardReports,
  readShardCoverage,
  RUN_REPORT_FILE,
  COVERAGE_FILE,
  DEFAULT_REPORT_DIR,
} from '../src/reportFiles.js';

const report = { schemaVersion: 1, tests: [] };

describe('writeRunReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the directory recursively', () => {
    writeRunReport('.twd/run', report, null);
    expect(fs.mkdirSync).toHaveBeenCalledWith('.twd/run', { recursive: true });
  });

  it('writes pretty-printed JSON so the report is readable by eye', () => {
    writeRunReport('.twd/run', report, null);
    const [file, body] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(file).toBe(`.twd/run/${RUN_REPORT_FILE}`);
    expect(body).toBe(`${JSON.stringify(report, null, 2)}\n`);
  });

  it('does not write a coverage file when there is no coverage', () => {
    writeRunReport('.twd/run', report, null);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(writeRunReport('.twd/run', report, null).coveragePath).toBeNull();
  });

  // Coverage stays raw and unformatted: it is machine input for nyc, routinely
  // several megabytes, and pretty-printing it would double the artifact size.
  it('writes coverage compactly alongside the report', () => {
    const coverage = { '/a.js': { s: { 0: 1 } } };
    const result = writeRunReport('.twd/run', report, coverage);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      `.twd/run/${COVERAGE_FILE}`,
      JSON.stringify(coverage),
    );
    expect(result.coveragePath).toBe(`.twd/run/${COVERAGE_FILE}`);
  });
});

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

describe('defaults', () => {
  it('defaults the report dir to .twd/run', () => {
    expect(DEFAULT_REPORT_DIR).toBe('./.twd/run');
  });
});
