import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printContractReport } from '../src/contractReport.js';

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('printContractReport', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints clean report when all mocks are valid', () => {
    const output = {
      results: [
        {
          alias: 'getPets',
          url: '/api/v1/pets',
          method: 'GET',
          status: 200,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: { valid: true, errors: [], warnings: [] },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    expect(hasErrors).toBe(false);
    const logs = stripAnsi(consoleSpy.mock.calls.map(c => c[0]).join('\n'));
    expect(logs).toContain('All mocks match');
    expect(logs).toContain('Mocks validated: 1');
  });

  it('prints errors with ✗ symbol', () => {
    const output = {
      results: [
        {
          alias: 'createPet',
          url: '/api/v1/pets',
          method: 'POST',
          status: 201,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: {
            valid: false,
            errors: [{ path: 'response.id', message: 'expected integer, got string', keyword: 'type' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    const logs = stripAnsi(consoleSpy.mock.calls.map(c => c[0]).join('\n'));
    expect(logs).toContain('✗');
    expect(logs).toContain('POST /v1/pets (201)');
    expect(logs).toContain('createPet');
    expect(logs).toContain('response.id');
    expect(logs).toContain('Errors: 1');
  });

  it('prints warnings with ⚠ symbol', () => {
    const output = {
      results: [
        {
          alias: 'serverError',
          url: '/api/v1/pets',
          method: 'GET',
          status: 500,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: {
            valid: true,
            errors: [],
            warnings: [{ type: 'UNMATCHED_STATUS', message: 'Status 500 not documented' }],
          },
        },
      ],
      skipped: [],
    };

    printContractReport(output);

    const logs = stripAnsi(consoleSpy.mock.calls.map(c => c[0]).join('\n'));
    expect(logs).toContain('⚠');
    expect(logs).toContain('Warnings: 1');
  });

  it('prints skipped mocks with ℹ symbol', () => {
    const output = {
      results: [],
      skipped: [
        { alias: 'adyenSetup', url: '/external/v1/sessions', reason: 'no matching contract' },
      ],
    };

    printContractReport(output);

    const logs = stripAnsi(consoleSpy.mock.calls.map(c => c[0]).join('\n'));
    expect(logs).toContain('ℹ');
    expect(logs).toContain('adyenSetup');
    expect(logs).toContain('Skipped: 1');
  });

  it('returns false when mode is warn even with errors', () => {
    const output = {
      results: [
        {
          alias: 'createPet',
          method: 'POST',
          status: 201,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: {
            valid: false,
            errors: [{ path: 'response.id', message: 'expected integer, got string', keyword: 'type' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    expect(hasErrors).toBe(false);
  });

  it('returns true when mode is error and has errors', () => {
    const output = {
      results: [
        {
          alias: 'createPet',
          method: 'POST',
          status: 201,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'error',
          validation: {
            valid: false,
            errors: [{ path: 'response.id', message: 'expected integer, got string', keyword: 'type' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    expect(hasErrors).toBe(true);
  });

  it('returns false when mode is error but no errors', () => {
    const output = {
      results: [
        {
          alias: 'getPets',
          method: 'GET',
          status: 200,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'error',
          validation: { valid: true, errors: [], warnings: [] },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    expect(hasErrors).toBe(false);
  });

  it('prints test name when present in result', () => {
    const output = {
      results: [
        {
          alias: 'getPets',
          url: '/api/v1/pets',
          method: 'GET',
          status: 200,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          testName: 'Cart > should load items',
          occurrence: 1,
          validation: { valid: true, errors: [], warnings: [] },
        },
      ],
      skipped: [],
    };

    printContractReport(output);

    const logs = stripAnsi(consoleSpy.mock.calls.map(c => c[0]).join('\n'));
    expect(logs).toContain('mock "getPets" — in "Cart > should load items"');
  });

  it('prints occurrence suffix when occurrence > 1', () => {
    const output = {
      results: [
        {
          alias: 'getPets',
          url: '/api/v1/pets',
          method: 'GET',
          status: 200,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          testName: 'Cart > should load items',
          occurrence: 2,
          validation: { valid: true, errors: [], warnings: [] },
        },
      ],
      skipped: [],
    };

    printContractReport(output);

    const logs = stripAnsi(consoleSpy.mock.calls.map(c => c[0]).join('\n'));
    expect(logs).toContain('mock "getPets" 2nd time — in "Cart > should load items"');
  });
});
