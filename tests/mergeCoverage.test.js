import { describe, it, expect } from 'vitest';
import { mergeCoverage } from '../src/mergeCoverage.js';

// Minimal but structurally valid Istanbul file coverage. istanbul-lib-coverage
// validates the shape, so the maps cannot be omitted.
function fileCoverage(path, statementHits, fnHits = 0) {
  return {
    path,
    statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
    fnMap: {
      0: {
        name: 'f',
        decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
      },
    },
    branchMap: {},
    s: { 0: statementHits },
    f: { 0: fnHits },
    b: {},
  };
}

describe('mergeCoverage', () => {
  it('sums statement hits for the same file across shards', () => {
    const merged = mergeCoverage([
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 1) },
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 2) },
    ]);
    expect(merged['/app/src/a.js'].s[0]).toBe(3);
  });

  it('sums function hits for the same file across shards', () => {
    const merged = mergeCoverage([
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 1, 4) },
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 1, 5) },
    ]);
    expect(merged['/app/src/a.js'].f[0]).toBe(9);
  });

  it('unions files that only one shard touched', () => {
    const merged = mergeCoverage([
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 1) },
      { '/app/src/b.js': fileCoverage('/app/src/b.js', 7) },
    ]);
    expect(Object.keys(merged).sort()).toEqual(['/app/src/a.js', '/app/src/b.js']);
    expect(merged['/app/src/b.js'].s[0]).toBe(7);
  });

  // A shard with no coverage file reads back as null and must not break the merge.
  it('skips null and undefined entries', () => {
    const merged = mergeCoverage([
      null,
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 2) },
      undefined,
    ]);
    expect(merged['/app/src/a.js'].s[0]).toBe(2);
  });

  it('returns an empty map for no input', () => {
    expect(mergeCoverage([])).toEqual({});
    expect(mergeCoverage([null])).toEqual({});
  });

  it('does not mutate its inputs', () => {
    const first = { '/app/src/a.js': fileCoverage('/app/src/a.js', 1) };
    mergeCoverage([first, { '/app/src/a.js': fileCoverage('/app/src/a.js', 5) }]);
    expect(first['/app/src/a.js'].s[0]).toBe(1);
  });
});
