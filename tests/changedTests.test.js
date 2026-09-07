import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('fs');

import { execFileSync } from 'node:child_process';
import fs from 'fs';
import { extractTitles, resolveChangedTitles } from "../src/changedTests.js";

describe("extractTitles", () => {
  it("takes the title out of it(...)", () => {
    expect(extractTitles("it('shows the empty state', async () => {")).toEqual([
      'shows the empty state',
    ]);
  });

  it("accepts every quote style", () => {
    const source = [
      "it('single', () => {})",
      'it("double", () => {})',
      'it(`backtick`, () => {})',
    ].join('\n');

    expect(extractTitles(source)).toEqual(['single', 'double', 'backtick']);
  });

  it("takes it.only, which still runs", () => {
    expect(extractTitles("it.only('focused case', () => {})")).toEqual(['focused case']);
  });

  it("ignores it.skip and xit, which do not run", () => {
    // Asking to record a skipped test is an exit-1 "no tests matched".
    const source = [
      "it.skip('parked', () => {})",
      "xit('also parked', () => {})",
      "it.todo('not written yet', () => {})",
    ].join('\n');

    expect(extractTitles(source)).toEqual([]);
  });

  it("does not match an it that is part of a longer word or a property", () => {
    const source = [
      "await wait('unit(not a test)')",
      "harness.it('a method called it', () => {})",
      "visit('/home')",
    ].join('\n');

    expect(extractTitles(source)).toEqual([]);
  });

  it("survives a title containing an apostrophe", () => {
    expect(extractTitles("it('the user\\'s profile loads', () => {})")).toEqual([
      "the user's profile loads",
    ]);
  });

  it("survives a title containing quotes of the other kind", () => {
    expect(extractTitles(`it('shows "no results" when empty', () => {})`)).toEqual([
      'shows "no results" when empty',
    ]);
  });

  it("tolerates whitespace between it and its title", () => {
    expect(extractTitles("it (\n  'spread over lines',\n)")).toEqual(['spread over lines']);
  });

  it("returns nothing for a file with no tests", () => {
    expect(extractTitles('export const helpers = {};')).toEqual([]);
  });

  it("drops an empty title rather than filtering on nothing", () => {
    // An empty needle matches every test path, so it would silently widen the
    // run to the whole suite.
    expect(extractTitles("it('', () => {})")).toEqual([]);
  });
});


// Routes each git invocation by its arguments, so one mock can answer the whole
// resolution sequence.
function mockGit({
  isRepo = true,
  refExists = true,
  mergeBase = 'base-sha',
  changedFiles = '',
  untracked = '',
  diff = '',
  gitMissing = false,
} = {}) {
  vi.mocked(execFileSync).mockImplementation((bin, args) => {
    if (gitMissing) {
      const error = new Error('spawnSync git ENOENT');
      error.code = 'ENOENT';
      throw error;
    }
    const call = args.join(' ');
    if (call.startsWith('rev-parse --git-dir')) {
      if (!isRepo) throw new Error('fatal: not a git repository');
      return '.git\n';
    }
    if (call.startsWith('rev-parse --verify')) {
      if (!refExists) throw new Error("fatal: Needed a single revision");
      return 'ref-sha\n';
    }
    if (call.startsWith('merge-base')) {
      if (mergeBase === null) throw new Error('fatal: no merge base found');
      return `${mergeBase}\n`;
    }
    if (call.startsWith('diff --name-only')) return changedFiles;
    if (call.startsWith('ls-files')) return untracked;
    if (call.startsWith('diff -U0')) return diff;
    return '';
  });
}

const gitCalls = () => vi.mocked(execFileSync).mock.calls.map(([, args]) => args.join(' '));

describe("resolveChangedTitles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('');
  });

  it("takes the titles a branch added", () => {
    mockGit({
      changedFiles: 'src/twd-tests/todo.twd.test.ts\n',
      diff: [
        '--- a/src/twd-tests/todo.twd.test.ts',
        '+++ b/src/twd-tests/todo.twd.test.ts',
        '@@ -4,0 +5,2 @@',
        "+  it('adds a todo', () => {})",
        "+  it('removes a todo', () => {})",
      ].join('\n'),
    });

    expect(resolveChangedTitles('origin/main').titles).toEqual(['adds a todo', 'removes a todo']);
  });

  it("ignores lines the branch removed or left alone", () => {
    // What a branch added is what a reviewer wants to watch; the tests that
    // already lived in the same file are noise, and pacing makes them expensive.
    mockGit({
      changedFiles: 'src/twd-tests/todo.twd.test.ts\n',
      diff: [
        '--- a/src/twd-tests/todo.twd.test.ts',
        '+++ b/src/twd-tests/todo.twd.test.ts',
        "+  it('added', () => {})",
        "-  it('deleted', () => {})",
        "   it('untouched', () => {})",
      ].join('\n'),
    });

    expect(resolveChangedTitles('origin/main').titles).toEqual(['added']);
  });

  it("diffs from the merge base, not the tip of the ref", () => {
    // A branch is not necessarily a descendant of wherever the base has moved.
    mockGit({ mergeBase: 'the-fork-point' });

    resolveChangedTitles('origin/main');

    expect(gitCalls()).toContain('merge-base origin/main HEAD');
    expect(gitCalls()).toContain('diff --name-only the-fork-point');
  });

  it("falls back to the ref itself when there is no merge base", () => {
    mockGit({ mergeBase: null });

    resolveChangedTitles('origin/main');

    expect(gitCalls()).toContain('diff --name-only origin/main');
  });

  it("compares against the working tree, so uncommitted work counts", () => {
    mockGit();

    resolveChangedTitles('origin/main');

    // `diff <base>` with no second ref. Naming HEAD would ignore the test a
    // developer just wrote.
    expect(gitCalls().some((c) => /^diff --name-only \S+$/.test(c))).toBe(true);
    expect(gitCalls().every((c) => !c.includes('HEAD') || c.startsWith('merge-base'))).toBe(true);
  });

  it("looks only at twd test files", () => {
    mockGit({
      changedFiles: [
        'src/twd-tests/todo.twd.test.ts',
        'src/components/Todo.vue',
        'src/utils/date.test.ts',
        'README.md',
      ].join('\n'),
    });

    resolveChangedTitles('origin/main');

    const diffCall = gitCalls().find((c) => c.startsWith('diff -U0'));
    expect(diffCall).toContain('src/twd-tests/todo.twd.test.ts');
    expect(diffCall).not.toContain('date.test.ts');
    expect(diffCall).not.toContain('Todo.vue');
  });

  it("accepts every extension the examples use", () => {
    mockGit({
      changedFiles: [
        'app/twd-tests/a.twd.test.tsx',
        'src/twd-test/b.twd.test.js',
        'src/twd-tests/c.twd.test.jsx',
      ].join('\n'),
    });

    resolveChangedTitles('origin/main');

    const diffCall = gitCalls().find((c) => c.startsWith('diff -U0'));
    expect(diffCall).toContain('a.twd.test.tsx');
    expect(diffCall).toContain('b.twd.test.js');
    expect(diffCall).toContain('c.twd.test.jsx');
  });

  it("counts an untracked test file as entirely added", () => {
    // git diff never shows an untracked file, so a brand-new test would
    // otherwise report as "nothing changed".
    mockGit({ untracked: 'src/twd-tests/brand-new.twd.test.ts\nnotes.md\n' });
    vi.mocked(fs.readFileSync).mockReturnValue("it('a brand new test', () => {})");

    expect(resolveChangedTitles('origin/main').titles).toEqual(['a brand new test']);
  });

  it("falls back to every title in a file whose body changed but whose titles did not", () => {
    mockGit({
      changedFiles: 'src/twd-tests/todo.twd.test.ts\n',
      diff: ['+  await page.click("#add");', '-  await page.click("#new");'].join('\n'),
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      "it('first', () => {})\nit('second', () => {})"
    );

    expect(resolveChangedTitles('origin/main').titles).toEqual(['first', 'second']);
  });

  it("does not read a changed file that was deleted", () => {
    mockGit({ changedFiles: 'src/twd-tests/gone.twd.test.ts\n', diff: '' });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(resolveChangedTitles('origin/main').titles).toEqual([]);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("returns each title once", () => {
    mockGit({
      changedFiles: 'a.twd.test.ts\nb.twd.test.ts\n',
      diff: ["+it('shared name', () => {})", "+it('shared name', () => {})"].join('\n'),
    });

    expect(resolveChangedTitles('origin/main').titles).toEqual(['shared name']);
  });

  it("reports no titles, and no error, when the branch changed no tests", () => {
    mockGit({ changedFiles: 'README.md\n' });

    expect(resolveChangedTitles('origin/main')).toEqual({
      titles: [],
      files: [],
      base: 'base-sha',
    });
  });

  it("names fetch-depth: 0 when the ref is not in the clone", () => {
    // actions/checkout defaults to fetch-depth: 1, so this is the first trap
    // every consumer hits.
    mockGit({ refExists: false });

    expect(() => resolveChangedTitles('origin/main')).toThrow(/fetch-depth: 0/);
    expect(() => resolveChangedTitles('origin/main')).toThrow(/origin\/main/);
  });

  it("says so when this is not a git repository", () => {
    mockGit({ isRepo: false });

    expect(() => resolveChangedTitles('origin/main')).toThrow(/not a git repository/i);
  });

  it("says so when git is not installed", () => {
    mockGit({ gitMissing: true });

    expect(() => resolveChangedTitles('origin/main')).toThrow(/git.*not found|not found.*git/i);
  });

  it("passes the ref to git as an argument, never as a string to a shell", () => {
    // A ref is user input and a branch name can contain almost anything.
    mockGit();

    resolveChangedTitles('origin/main; rm -rf /');

    for (const [bin, args] of vi.mocked(execFileSync).mock.calls) {
      expect(bin).toBe('git');
      expect(Array.isArray(args)).toBe(true);
    }
  });
});
