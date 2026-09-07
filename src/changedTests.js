/**
 * Which tests a branch touched, worked out from git.
 *
 * Recording the whole suite is the wrong default in CI: a reviewer wants to
 * watch what the pull request built, and pacing makes the difference expensive.
 * Every consumer was hand-rolling the same git command — a script, a workflow
 * step to count its output, a bash loop building `--test` arguments — so this
 * brings the one fact they were all computing into the CLI.
 *
 * Which tests changed is a FACT, so it is computed rather than guessed: a git
 * diff cannot invent a title, and a wrong title is an exit-1 "no tests matched"
 * rather than a silently different recording.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'node:child_process';

/**
 * `it(` and `it.only(`, never `it.skip(`, `it.todo(` or `xit(` — a test that
 * does not run cannot be recorded, so selecting one is an exit-1 "no tests
 * matched". The leading `(?<![.\w])` is what keeps `visit(`, `await wait(` and
 * `harness.it(` out.
 *
 * Copied from twd-vue-example/scripts/changed-test-titles.mjs, where it has
 * been in use; the escape handling in the title body is easy to get subtly
 * wrong when rewritten from scratch.
 */
const IT = /(?<![.\w])it(?:\.only)?\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

const unescape = (raw) => raw.replace(/\\(['"`\\])/g, '$1').trim();

/**
 * Every `it()` title in a piece of source, in the order they appear.
 *
 * An empty title is dropped rather than returned: filters match on substring,
 * so an empty needle matches every test path and would quietly widen the run to
 * the whole suite — the opposite of what this flag is for.
 */
export function extractTitles(source) {
  const titles = [];
  for (const match of String(source).matchAll(IT)) {
    const title = unescape(match[2]);
    if (title) titles.push(title);
  }
  return titles;
}

/**
 * The twd test file suffix, which is the reliable signal.
 *
 * The directory is not: the example apps use `src/twd-tests`, `app/twd-tests`
 * and `src/twd-test` between them, while every one of them names files
 * `*.twd.test.*`. Restricting to it also keeps the project's Vitest suite out,
 * which uses `it()` too and would otherwise contribute titles.
 */
const TEST_FILE = /\.twd\.test\.[cm]?[jt]sx?$/;

// An argument array, never a string: a ref is user input and a branch name can
// contain almost anything. stderr is captured rather than inherited, so a
// failed probe does not print git's own wording over ours.
function git(args, cwd) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const lines = (output) => String(output).split('\n').map((line) => line.trim()).filter(Boolean);

function shallowCloneHelp(ref) {
  return [
    `--changed-since ${ref}: ${ref} is not in this clone.`,
    '',
    'In GitHub Actions, set `fetch-depth: 0` on actions/checkout. It defaults to 1,',
    'which fetches no history, so the base branch is not present to diff against.',
  ].join('\n');
}

/**
 * The `it()` titles this branch added or changed, ready to feed the same filter
 * `--test` uses.
 *
 * Added lines rather than changed files, on purpose: the tests a branch wrote
 * are what a reviewer wants to watch, and the ones that already lived in the
 * same file are noise that pacing makes expensive. Falls back to every title in
 * the changed files when the diff added no `it()` at all, since a body can
 * change without its title line moving and recording nothing would be worse
 * than recording a little too much.
 */
export function resolveChangedTitles(ref, cwd = process.cwd()) {
  try {
    git(['rev-parse', '--git-dir'], cwd);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('--changed-since needs git, which was not found on your PATH.');
    }
    throw new Error(`--changed-since needs a git repository, and ${cwd} is not a git repository.`);
  }

  try {
    git(['rev-parse', '--verify', `${ref}^{commit}`], cwd);
  } catch {
    throw new Error(shallowCloneHelp(ref));
  }

  // The merge base, not the tip of the ref: a branch is not necessarily a
  // descendant of wherever the base has moved to since it was cut.
  let base = ref;
  try {
    base = git(['merge-base', ref, 'HEAD'], cwd).trim() || ref;
  } catch {
    // Unrelated histories, or a ref with no common ancestor. Diff from it
    // directly rather than refusing to run.
  }

  // `diff <base>` with no second ref, so the comparison runs to the working
  // tree. In CI the tree is clean and this is identical to `<base> HEAD`.
  const tracked = lines(git(['diff', '--name-only', base], cwd)).filter((f) => TEST_FILE.test(f));
  // git diff never reports an untracked file, so without this a brand-new test
  // file reads as "this branch changed no tests".
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard'], cwd))
    .filter((f) => TEST_FILE.test(f));

  const files = [...new Set([...tracked, ...untracked])];
  if (files.length === 0) return { titles: [], files: [], base };

  const titles = new Set();

  if (tracked.length > 0) {
    const diff = git(['diff', '-U0', base, '--', ...tracked], cwd);
    for (const line of diff.split('\n')) {
      // `+++ b/path` is a header, not an added line.
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      for (const title of extractTitles(line.slice(1))) titles.add(title);
    }
  }

  // An untracked file has no diff to read; all of it is new.
  for (const file of untracked) {
    const absolute = path.resolve(cwd, file);
    if (!fs.existsSync(absolute)) continue;
    for (const title of extractTitles(fs.readFileSync(absolute, 'utf8'))) titles.add(title);
  }

  if (titles.size === 0) {
    for (const file of files) {
      const absolute = path.resolve(cwd, file);
      // A deleted file still shows in the diff and has no titles to record.
      if (!fs.existsSync(absolute)) continue;
      for (const title of extractTitles(fs.readFileSync(absolute, 'utf8'))) titles.add(title);
    }
  }

  return { titles: [...titles], files, base };
}
