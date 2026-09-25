import { describe, it, expect } from 'vitest';
import { renderMarkdown, MARKDOWN_MAX_CHARS } from '../src/reportMarkdown.js';
import { report, contractResult, invalid } from './reportFixtures.js';

describe('renderMarkdown', () => {
  it('renders a green run as heading and counts only', () => {
    const md = renderMarkdown(report());
    expect(md).toMatch(/^### ✅ TWD: 3 passed$/m);
    expect(md).toContain('| 3 | 0 | 0 | 12.4s |');
    expect(md).not.toContain('Needs attention');
  });

  it('names what broke in the heading', () => {
    const md = renderMarkdown(report({
      tests: [{ id: 't1', status: 'fail', error: 'e' }, { id: 't2', status: 'fail', error: 'e' }],
      contracts: { results: [contractResult({ validation: invalid() })] },
    }));
    expect(md).toMatch(/^### ❌ TWD: 2 tests failed, 1 contract error$/m);
  });

  it('adds a contracts column only when contracts are configured', () => {
    expect(renderMarkdown(report())).not.toContain('Contracts');
    const md = renderMarkdown(report({ contracts: { results: [contractResult()] } }));
    expect(md).toContain('| Passed | Failed | Skipped | Contracts | Duration |');
    expect(md).toContain('1 ✓ · 0 ✕ · 0 ⚠');
  });

  it('lists each failure with its first error line', () => {
    const md = renderMarkdown(report({
      tests: [{ id: 't1', status: 'fail', error: 'Expected visible\nroles dump...' }],
    }));
    expect(md).toContain('- ❌ **Invoices › shows empty state** _(3 attempts)_');
    expect(md).toContain('  > `Expected visible`');
    expect(md).not.toContain('roles dump');
  });

  it('attaches snapshot line to test when error names a snapshot', () => {
    const md = renderMarkdown(report({
      tests: [{ id: 't1', status: 'fail', error: 'Layout snapshot "invoice-form" differs' }],
      snapshots: [{ name: 'invoice-form', file: 'snapshots/invoice-form.failed.png' }],
    }));
    expect(md).toContain('- ❌ **Invoices › shows empty state** _(3 attempts)_');
    expect(md).toContain('  > Layout snapshot `invoice-form` differs, diff in the report');
  });

  it('lists orphan snapshot as its own entry', () => {
    const md = renderMarkdown(report({
      snapshots: [{ name: 'orphan', file: 'snapshots/orphan.failed.png' }],
    }));
    expect(md).toContain('- ❌ **Layout snapshot** `orphan` differs, diff in the report');
  });

  it('lists a contract failure with the test that used the mock', () => {
    const md = renderMarkdown(report({ contracts: { results: [contractResult({ validation: invalid() })] } }));
    expect(md).toContain('- ❌ **Contract** `GET /invoices 200` (getInvoices), openapi.json');
    expect(md).toContain('  > `response/items/0/total`: expected number, got string. Used by _Invoices › loads_');
  });

  it('folds warnings', () => {
    const md = renderMarkdown(report({
      contracts: { results: [contractResult({ mode: 'warn', validation: invalid() })] },
    }));
    expect(md).toContain('<details><summary>1 contract warning</summary>');
  });

  it('caps the list at 20 and points at the HTML', () => {
    const tests = Array.from({ length: 25 }, (_, i) => ({ id: `x${i}`, status: 'fail', error: 'e' }));
    const handlers = tests.map((t) => ({ id: t.id, name: t.id, parent: null, type: 'test' }));
    const md = renderMarkdown(report({ tests, handlers, allTestIds: tests.map((t) => t.id), executed: 25 }));
    expect(md.match(/^- ❌/gm)).toHaveLength(20);
    expect(md).toContain('…and 5 more, see `index.html`');
  });

  it('stays under the size limit with huge errors', () => {
    const huge = 'x'.repeat(20_000);
    const tests = Array.from({ length: 50 }, (_, i) => ({ id: `x${i}`, status: 'fail', error: huge }));
    const handlers = tests.map((t) => ({ id: t.id, name: t.id, parent: null, type: 'test' }));
    const md = renderMarkdown(report({ tests, handlers, allTestIds: tests.map((t) => t.id), executed: 50 }));
    expect(md.length).toBeLessThan(MARKDOWN_MAX_CHARS);
  });

  it('escapes names so they cannot inject HTML or break formatting', () => {
    const handlers = [{ id: 'h', name: '<img src=x onerror=alert(1)> *bold* `tick`', parent: null, type: 'test' }];
    const md = renderMarkdown(report({
      handlers, allTestIds: ['h'], executed: 1,
      tests: [{ id: 'h', status: 'fail', error: 'has `backticks`' }],
    }));
    expect(md).not.toMatch(/(^|[^\\])<img/m);
    expect(md).toContain('\\<img');
    expect(md).toContain('\\*bold\\*');
    expect(md).toContain("> `has 'backticks'`");
  });

  it('renders an interrupted run with its error and diagnostic', () => {
    const md = renderMarkdown(report({
      tests: [], executed: 0,
      error: { message: 'net::ERR_CONNECTION_REFUSED', diagnostic: 'Is your dev server running?' },
    }));
    expect(md).toMatch(/^### ⚠️ TWD: run interrupted$/m);
    expect(md).toContain('net::ERR_CONNECTION_REFUSED');
    expect(md).toContain('Is your dev server running?');
  });

  it('says when the run stopped early', () => {
    const r = report({ tests: [{ id: 't1', status: 'fail' }], stoppedEarly: true, notRun: 2 });
    expect(renderMarkdown(r)).toContain('Stopped early at the failure limit: 2 not run.');
  });
});
