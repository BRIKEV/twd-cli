/**
 * Renders the diagnostics snapshot twd-js hangs off a failed test.
 *
 * The snapshot is plain data — `{ location, mockRules }` — so it serialises
 * straight out of `page.evaluate()` and is rendered here, in Node. That split
 * is the whole point: the in-page `onFail` is a stringified function with no
 * module scope, so a formatter shared with twd-js could only reach it through
 * new public surface on the library (a `window.__twdFormatDiagnostics`).
 * Carrying the data out instead needs nothing from twd-js, and puts the
 * rendering where the rest of this package's output already lives.
 *
 * Only the mock-rule signal is rendered. twd-js's own block also carries a
 * `location` row, but every failure message here already ends in
 * `(at <href>)`, and the full href is strictly more informative than the
 * snapshot's pathname + search + hash. Printing both would say the same thing
 * twice.
 */

// A page with fifteen mocks must not produce fifteen lines. The rules that did
// fire are only interesting as a count; it is the misses that name the bug.
const LIST_CAP = 5;

// Aligns a continuation row under the value column of `mock rules  `.
const CONTINUATION = ' '.repeat(12);

export function formatFailureDiagnostics(diagnostics) {
  const mockRules = diagnostics?.mockRules;
  // Omitted by twd-js whenever the test registered no rules, and absent
  // entirely on a twd-js that predates diagnostics. Never render `0/0`:
  // "this test mocks nothing" is not a diagnostic, it is the default.
  if (!mockRules) return [];

  const { registered, triggered } = mockRules;
  const untriggered = mockRules.untriggered ?? [];
  const summary = `${triggered}/${registered} triggered`;

  if (untriggered.length === 0) return [`mock rules  ${summary}`];
  if (untriggered.length === 1) {
    return [`mock rules  ${summary} — ${untriggered[0]} never requested`];
  }

  const lines = [`mock rules  ${summary} — ${untriggered.length} never requested`];
  for (const alias of untriggered.slice(0, LIST_CAP)) {
    lines.push(`${CONTINUATION}✗ ${alias}`);
  }
  const rest = untriggered.length - LIST_CAP;
  if (rest > 0) lines.push(`${CONTINUATION}+${rest} more`);
  return lines;
}
