import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadContracts, validateMocks } from '../src/contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('loadContracts', () => {
  let consoleWarnSpy;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('loads a valid spec file and returns initialized validator', async () => {
    const contracts = [{ source: './tests/fixtures/petstore-3.0.json' }];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result).toHaveLength(1);
    expect(result[0].validator).toBeDefined();
    expect(result[0].baseUrl).toBe('/');
    expect(result[0].mode).toBe('warn');
    expect(result[0].strict).toBe(true);
  });

  it('applies custom baseUrl, mode, and strict from config', async () => {
    const contracts = [{
      source: './tests/fixtures/petstore-3.0.json',
      baseUrl: '/api',
      mode: 'error',
      strict: false,
    }];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result[0].baseUrl).toBe('/api');
    expect(result[0].mode).toBe('error');
    expect(result[0].strict).toBe(false);
  });

  it('warns and skips when source file does not exist', async () => {
    const contracts = [{ source: './nonexistent.json' }];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not read')
    );
  });

  it('warns and skips when source file is invalid JSON', async () => {
    const contracts = [{ source: './vitest.config.js' }];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not parse')
    );
  });

  it('loads multiple contracts', async () => {
    const contracts = [
      { source: './tests/fixtures/petstore-3.0.json', baseUrl: '/pets' },
      { source: './tests/fixtures/petstore-3.0.json', baseUrl: '/other' },
    ];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result).toHaveLength(2);
    expect(result[0].baseUrl).toBe('/pets');
    expect(result[1].baseUrl).toBe('/other');
  });
});

describe('validateMocks', () => {
  let loadedContracts;

  beforeEach(async () => {
    loadedContracts = await loadContracts(
      [{ source: './tests/fixtures/petstore-3.0.json', baseUrl: '/api' }],
      path.resolve(__dirname, '..'),
    );
  });

  it('validates a matching mock with valid response', () => {
    const mocks = new Map();
    mocks.set('getPets', {
      alias: 'getPets',
      url: '/api/v1/pets',
      method: 'GET',
      status: 200,
      response: [{ id: 1, name: 'Fido' }],
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    expect(output.results[0].validation.valid).toBe(true);
    expect(output.skipped).toHaveLength(0);
  });

  it('validates a matching mock with invalid response', () => {
    const mocks = new Map();
    mocks.set('createPet', {
      alias: 'createPet',
      url: '/api/v1/pets',
      method: 'POST',
      status: 201,
      response: { id: 'not-a-number', name: 'Fido' },
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    expect(output.results[0].validation.valid).toBe(false);
    expect(output.results[0].validation.errors.length).toBeGreaterThan(0);
  });

  it('strips baseUrl before matching', () => {
    const mocks = new Map();
    mocks.set('getPet', {
      alias: 'getPet',
      url: '/api/v1/pets/123',
      method: 'GET',
      status: 200,
      response: { id: 1, name: 'Fido' },
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    expect(output.results[0].matchedPath).toBe('/v1/pets/{petId}');
  });

  it('skips urlRegex mocks', () => {
    const mocks = new Map();
    mocks.set('updateOrder', {
      alias: 'updateOrder',
      url: '/\\/api\\/v1\\/orders\\/.*/',
      method: 'PATCH',
      status: 200,
      response: {},
      urlRegex: true,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(0);
    expect(output.skipped).toHaveLength(1);
    expect(output.skipped[0].reason).toBe('urlRegex mock');
  });

  it('skips mocks that do not match any contract baseUrl', () => {
    const mocks = new Map();
    mocks.set('adyenSetup', {
      alias: 'adyenSetup',
      url: '/external/v1/sessions',
      method: 'POST',
      status: 200,
      response: { id: 'session-1' },
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(0);
    expect(output.skipped).toHaveLength(1);
    expect(output.skipped[0].reason).toBe('no matching contract');
  });

  it('returns warning for undocumented status code', () => {
    const mocks = new Map();
    mocks.set('serverError', {
      alias: 'serverError',
      url: '/api/v1/pets',
      method: 'GET',
      status: 500,
      response: { error: 'boom' },
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    expect(output.results[0].validation.warnings.length).toBeGreaterThan(0);
    expect(output.results[0].validation.warnings[0].type).toBe('UNMATCHED_STATUS');
  });
});

describe('validateMocks with testId and occurrence', () => {
  let loadedContracts;

  beforeEach(async () => {
    loadedContracts = await loadContracts(
      [{ source: './tests/fixtures/petstore-3.0.json', baseUrl: '/api' }],
      path.resolve(__dirname, '..'),
    );
  });

  it('validates multiple mocks with same alias but different endpoints', () => {
    const mocks = new Map();
    mocks.set('GET:/api/v1/pets:200:test-1:1', {
      alias: 'getData',
      url: '/api/v1/pets',
      method: 'GET',
      status: 200,
      response: [{ id: 1, name: 'Fido' }],
      urlRegex: false,
      testId: 'test-1',
      occurrence: 1,
    });
    mocks.set('POST:/api/v1/pets:201:test-2:1', {
      alias: 'getData',
      url: '/api/v1/pets',
      method: 'POST',
      status: 201,
      response: { id: 1, name: 'Fido' },
      urlRegex: false,
      testId: 'test-2',
      occurrence: 1,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(2);
  });

  it('validates same alias called twice in same test (different occurrences)', () => {
    const mocks = new Map();
    mocks.set('GET:/api/v1/pets:200:test-1:1', {
      alias: 'getPets',
      url: '/api/v1/pets',
      method: 'GET',
      status: 200,
      response: [{ id: 1, name: 'Fido' }],
      urlRegex: false,
      testId: 'test-1',
      occurrence: 1,
    });
    mocks.set('GET:/api/v1/pets:200:test-1:2', {
      alias: 'getPets',
      url: '/api/v1/pets',
      method: 'GET',
      status: 200,
      response: [{ id: 2, name: 'Rex' }],
      urlRegex: false,
      testId: 'test-1',
      occurrence: 2,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(2);
    expect(output.results[0].validation.valid).toBe(true);
    expect(output.results[1].validation.valid).toBe(true);
  });
});

describe('validateMocks — Content-Type forwarding', () => {
  let loadedContracts;

  beforeEach(async () => {
    loadedContracts = await loadContracts(
      [{ source: './tests/fixtures/petstore-3.0.json', baseUrl: '/api' }],
      path.resolve(__dirname, '..'),
    );
  });

  it('forwards Content-Type from responseHeaders so image/* endpoints match', () => {
    const mocks = new Map();
    mocks.set('getPetPhoto', {
      alias: 'getPetPhoto',
      url: '/api/v1/pets/123/photo',
      method: 'GET',
      status: 200,
      response: 'fake-binary-data',
      urlRegex: false,
      responseHeaders: { 'Content-Type': 'image/png' },
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    const missingSchema = output.results[0].validation.warnings.filter(
      w => w.type === 'MISSING_SCHEMA'
    );
    expect(missingSchema).toHaveLength(0);
    expect(output.results[0].validation.errors).toHaveLength(0);
  });
});
