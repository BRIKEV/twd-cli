import { buildRunReport } from '../src/runReport.js';

export const HANDLERS = [
  { id: 's1', name: 'Invoices', parent: null, type: 'suite' },
  { id: 't1', name: 'shows empty state', parent: 's1', type: 'test' },
  { id: 't2', name: 'loads', parent: 's1', type: 'test' },
  { id: 't3', name: 'matches layout', parent: 's1', type: 'test' },
];

export const invalid = (message = 'expected number, got string') => ({
  valid: false, errors: [{ path: 'response/items/0/total', message }], warnings: [],
});

export function contractResult(overrides = {}) {
  return {
    alias: 'getInvoices', url: 'http://api/invoices', method: 'GET', status: 200,
    specSource: 'openapi.json', matchedPath: '/invoices', mode: 'error',
    testName: 'Invoices > loads', occurrence: 1,
    validation: { valid: true, errors: [], warnings: [] },
    ...overrides,
  };
}

export function report(overrides = {}) {
  const { contracts, ...rest } = overrides;
  return buildRunReport({
    shard: { index: 1, total: 1 },
    startedAt: 0,
    endedAt: 12_400,
    allTestIds: ['t1', 't2', 't3'],
    handlers: HANDLERS,
    tests: [
      { id: 't1', status: 'pass' },
      { id: 't2', status: 'pass' },
      { id: 't3', status: 'pass' },
    ],
    executed: 3,
    notRun: 0,
    stoppedEarly: false,
    retryCount: 2,
    version: '1.10.0',
    url: 'http://localhost:5173',
    contracts: contracts
      ? { configured: true, partial: false, skipped: [], ...contracts }
      : undefined,
    ...rest,
  });
}
