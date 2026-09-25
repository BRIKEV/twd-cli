import { describe, it, expect } from 'vitest';
import { needsAttention, contractWarnings } from '../src/needsAttention.js';
import { report, contractResult, invalid } from './reportFixtures.js';

describe('needsAttention', () => {
  it('is empty on a green run', () => {
    expect(needsAttention(report())).toEqual([]);
  });

  it('lists failed tests in run order with their error and attempts', () => {
    const items = needsAttention(report({
      tests: [
        { id: 't1', status: 'fail', error: 'first' },
        { id: 't2', status: 'pass' },
        { id: 't3', status: 'fail', error: 'second' },
      ],
    }));
    expect(items.map((i) => [i.kind, i.path, i.error, i.attempts])).toEqual([
      ['test', 'Invoices > shows empty state', 'first', 3],
      ['test', 'Invoices > matches layout', 'second', 3],
    ]);
  });

  it('attaches a snapshot capture to the test whose error names it', () => {
    const [item] = needsAttention(report({
      tests: [{ id: 't3', status: 'fail', error: 'Layout snapshot "invoice-form" changed - Capture: __twd_snapshots__/invoice-form.failed.png' }],
      snapshots: [{ name: 'invoice-form', file: 'snapshots/invoice-form.failed.png' }],
    }));
    expect(item.snapshot).toEqual({ name: 'invoice-form', file: 'snapshots/invoice-form.failed.png' });
  });

  // A bare substring match on a short name would pair with almost any error.
  it('does not pair a short snapshot name against an unrelated error', () => {
    const [item] = needsAttention(report({
      tests: [{ id: 't3', status: 'fail', error: 'assertion failed: expected true' }],
      snapshots: [{ name: 'a', file: 'snapshots/a.failed.png' }],
    }));
    expect(item.snapshot).toBeNull();
  });

  it('lists an unmatched snapshot capture as its own entry', () => {
    const items = needsAttention(report({
      snapshots: [{ name: 'orphan', file: 'snapshots/orphan.failed.png' }],
    }));
    expect(items).toEqual([{ kind: 'snapshot', name: 'orphan', file: 'snapshots/orphan.failed.png' }]);
  });

  it('lists error-mode contract failures after the tests', () => {
    const items = needsAttention(report({
      tests: [{ id: 't1', status: 'fail', error: 'x' }],
      contracts: { results: [contractResult({ validation: invalid() })] },
    }));
    expect(items.map((i) => i.kind)).toEqual(['test', 'contract']);
    expect(items[1]).toMatchObject({
      method: 'GET', matchedPath: '/invoices', status: 200, alias: 'getInvoices',
      spec: 'openapi.json', testName: 'Invoices > loads',
      errors: [{ path: 'response/items/0/total', message: 'expected number, got string' }],
    });
  });

  it('leaves warn-mode failures out', () => {
    expect(needsAttention(report({
      contracts: { results: [contractResult({ mode: 'warn', validation: invalid() })] },
    }))).toEqual([]);
  });

  // Merged reports concatenate shards; position is the true run order.
  it('orders by test index when present', () => {
    const r = report({ tests: [{ id: 't3', status: 'fail' }, { id: 't1', status: 'fail' }] });
    expect(needsAttention(r).map((i) => i.path)).toEqual([
      'Invoices > shows empty state', 'Invoices > matches layout',
    ]);
  });
});

describe('contractWarnings', () => {
  it('collects warn-mode failures and validation warnings', () => {
    const warnings = contractWarnings(report({
      contracts: {
        results: [
          contractResult({ mode: 'warn', validation: invalid('nope') }),
          contractResult({ alias: 'b', validation: { valid: true, errors: [], warnings: [{ message: 'extra field' }] } }),
          contractResult({ alias: 'c' }),
        ],
      },
    }));
    expect(warnings.map((w) => [w.alias, w.messages])).toEqual([
      ['getInvoices', ['response/items/0/total: nope']],
      ['b', ['extra field']],
    ]);
  });
});
