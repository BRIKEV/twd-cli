import { describe, it, expect } from 'vitest';
import { generateContractMarkdown } from '../src/contractMarkdown.js';

describe('generateContractMarkdown', () => {
  it('generates summary table with passed and failed counts', () => {
    const output = {
      results: [
        {
          alias: 'getUsers', url: '/api/users', method: 'GET', status: 200,
          specSource: './contracts/users.json', matchedPath: '/users', mode: 'warn',
          validation: { valid: true, errors: [], warnings: [] },
        },
        {
          alias: 'getUserBad', url: '/api/users/1', method: 'GET', status: 200,
          specSource: './contracts/users.json', matchedPath: '/users/{userId}', mode: 'warn',
          validation: {
            valid: false,
            errors: [{ path: 'response.address', message: 'missing required property', keyword: 'required' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const md = generateContractMarkdown(output);

    expect(md).toContain('## TWD Contract Validation');
    expect(md).toContain('| Spec | Passed | Failed | Warnings | Mode |');
    expect(md).toContain('`./contracts/users.json`');
    expect(md).toContain('| 1 | **1** | 0 | `warn` |');
    expect(md).toContain('**1 passed**');
    expect(md).toContain('**1 failed**');
  });

  it('shows collapsed details for failed validations', () => {
    const output = {
      results: [
        {
          alias: 'getBadProduct', url: '/api/products', method: 'GET', status: 200,
          specSource: './contracts/products.json', matchedPath: '/products', mode: 'error',
          validation: {
            valid: false,
            errors: [
              { path: 'response[0].name', message: 'must NOT have fewer than 1 characters', keyword: 'minLength' },
              { path: 'response[0].currency', message: 'must be one of: "USD", "EUR"', keyword: 'enum' },
            ],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const md = generateContractMarkdown(output);

    expect(md).toContain('<details>');
    expect(md).toContain('<summary>Failed validations</summary>');
    expect(md).toContain('`GET /products`');
    expect(md).toContain('mock `getBadProduct`');
    expect(md).toContain('`response[0].name`: must NOT have fewer than 1 characters');
    expect(md).toContain('`response[0].currency`: must be one of: "USD", "EUR"');
    expect(md).toContain('</details>');
  });

  it('includes warnings count in table', () => {
    const output = {
      results: [
        {
          alias: 'getNotFound', url: '/api/users/999', method: 'GET', status: 404,
          specSource: './contracts/users.json', matchedPath: '/users/{userId}', mode: 'warn',
          validation: {
            valid: true,
            errors: [],
            warnings: [{ type: 'UNMATCHED_STATUS', message: 'Status 404 not documented' }],
          },
        },
      ],
      skipped: [],
    };

    const md = generateContractMarkdown(output);

    expect(md).toContain('| 0 | 0 | **1** | `warn` |');
    expect(md).toContain('**1 warnings**');
  });

  it('includes skipped count in totals', () => {
    const output = {
      results: [
        {
          alias: 'getUsers', url: '/api/users', method: 'GET', status: 200,
          specSource: './contracts/users.json', matchedPath: '/users', mode: 'warn',
          validation: { valid: true, errors: [], warnings: [] },
        },
      ],
      skipped: [
        { alias: 'getUnknown', url: '/api/unknown', reason: 'no matching contract' },
      ],
    };

    const md = generateContractMarkdown(output);

    expect(md).toContain('1 skipped');
  });

  it('does not show details section when everything passes', () => {
    const output = {
      results: [
        {
          alias: 'getUsers', url: '/api/users', method: 'GET', status: 200,
          specSource: './contracts/users.json', matchedPath: '/users', mode: 'warn',
          validation: { valid: true, errors: [], warnings: [] },
        },
      ],
      skipped: [],
    };

    const md = generateContractMarkdown(output);

    expect(md).not.toContain('<details>');
    expect(md).toContain('0 failed');
  });

  it('groups failures by spec source in details', () => {
    const output = {
      results: [
        {
          alias: 'badUser', url: '/api/users/1', method: 'GET', status: 200,
          specSource: './contracts/users.json', matchedPath: '/users/{userId}', mode: 'error',
          validation: {
            valid: false,
            errors: [{ path: 'response.name', message: 'missing required property', keyword: 'required' }],
            warnings: [],
          },
        },
        {
          alias: 'badEvent', url: '/api/events', method: 'GET', status: 200,
          specSource: './contracts/events.json', matchedPath: '/events', mode: 'warn',
          validation: {
            valid: false,
            errors: [{ path: 'response', message: 'must NOT have fewer than 1 items', keyword: 'minItems' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const md = generateContractMarkdown(output);

    expect(md).toContain('**./contracts/users.json**');
    expect(md).toContain('**./contracts/events.json**');
    expect(md).toContain('mock `badUser`');
    expect(md).toContain('mock `badEvent`');
  });

  it('includes test name in failure details', () => {
    const output = {
      results: [
        {
          alias: 'getBadProduct', url: '/api/products', method: 'GET', status: 200,
          specSource: './contracts/products.json', matchedPath: '/products', mode: 'error',
          testName: 'Products > should display list',
          occurrence: 1,
          validation: {
            valid: false,
            errors: [{ path: 'response[0].name', message: 'missing required field', keyword: 'required' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const md = generateContractMarkdown(output);

    expect(md).toContain('mock `getBadProduct` — in "Products > should display list"');
  });

  it('includes occurrence suffix in failure details when > 1', () => {
    const output = {
      results: [
        {
          alias: 'getPets', url: '/api/pets', method: 'GET', status: 200,
          specSource: './contracts/pets.json', matchedPath: '/pets', mode: 'error',
          testName: 'Pets > should reload',
          occurrence: 2,
          validation: {
            valid: false,
            errors: [{ path: 'response', message: 'expected array', keyword: 'type' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const md = generateContractMarkdown(output);

    expect(md).toContain('mock `getPets` 2nd time — in "Pets > should reload"');
  });
});
