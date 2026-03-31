import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadContracts, validateMocks } from '../src/contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function makeMock(key, overrides) {
  return new Map([[key, { urlRegex: false, ...overrides }]]);
}

/**
 * Runs the same suite against both 3.0 and 3.1 fixtures to ensure
 * feature parity (including nullable normalization for 3.0).
 */
describe.each([
  ['OpenAPI 3.0', './tests/fixtures/comprehensive-3.0.json'],
  ['OpenAPI 3.1', './tests/fixtures/comprehensive-3.1.json'],
])('%s — comprehensive contract validation', (label, specPath) => {
  let contracts;

  beforeAll(async () => {
    contracts = await loadContracts(
      [{ source: specPath, baseUrl: '/api', mode: 'error', strict: false }],
      ROOT,
    );
    expect(contracts).toHaveLength(1);
  });

  // ── string: minLength / maxLength ─────────────────────────────────
  describe('string: minLength / maxLength', () => {
    it('accepts a name within length bounds', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Widget', price: 9.99, currency: 'USD', inStock: true, category: 'electronics' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects an empty name (minLength: 1)', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: '', price: 9.99, currency: 'USD', inStock: true, category: 'electronics' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'minLength')).toBe(true);
    });

    it('rejects a name exceeding maxLength (200)', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'A'.repeat(201), price: 9.99, currency: 'USD', inStock: true, category: 'electronics' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'maxLength')).toBe(true);
    });
  });

  // ── string: pattern ───────────────────────────────────────────────
  describe('string: pattern', () => {
    it('accepts a valid SKU matching pattern', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Widget', price: 9.99, currency: 'USD', inStock: true, category: 'electronics', sku: 'AB-1234' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects an invalid SKU not matching pattern', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Widget', price: 9.99, currency: 'USD', inStock: true, category: 'electronics', sku: 'invalid-sku' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'pattern')).toBe(true);
    });
  });

  // ── string: format (date, date-time, email, uuid, uri, hostname, ipv4, ipv6) ──
  describe('string: formats', () => {
    const validProduct = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Widget', price: 9.99, currency: 'USD', inStock: true, category: 'electronics',
    };

    it('accepts valid uuid format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects invalid uuid format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, id: 'not-a-uuid' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'format')).toBe(true);
    });

    it('accepts valid date-time format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, createdAt: '2026-03-31T12:30:00Z' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects invalid date-time format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, createdAt: '31-03-2026' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'format')).toBe(true);
    });

    it('accepts valid date format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, releaseDate: '2026-03-31' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects invalid date format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, releaseDate: 'March 31, 2026' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'format')).toBe(true);
    });

    it('accepts valid email format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, contactEmail: 'user@example.com' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects invalid email format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, contactEmail: 'not-an-email' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'format')).toBe(true);
    });

    it('accepts valid uri format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, website: 'https://example.com/products' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects invalid uri format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, website: 'not a uri' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'format')).toBe(true);
    });

    it('accepts valid hostname format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, origin: 'api.example.com' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('accepts valid ipv4 format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, serverIp: '192.168.1.1' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects invalid ipv4 format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, serverIp: '999.999.999.999' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'format')).toBe(true);
    });

    it('accepts valid ipv6 format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, serverIpV6: '::1' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects invalid ipv6 format', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, serverIpV6: 'not-ipv6' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'format')).toBe(true);
    });
  });

  // ── number / integer: minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf ──
  describe('number / integer constraints', () => {
    const validProduct = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Widget', price: 9.99, currency: 'USD', inStock: true, category: 'electronics',
    };

    it('rejects price of 0 (exclusiveMinimum: 0)', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, price: 0 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'exclusiveMinimum')).toBe(true);
    });

    it('accepts price just above 0', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, price: 0.01 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects negative quantity (minimum: 0)', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, quantity: -1 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'minimum')).toBe(true);
    });

    it('rejects quantity above maximum (999999)', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, quantity: 1000000 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'maximum')).toBe(true);
    });

    it('rejects weight not multipleOf 0.01', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, weight: 1.005 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'multipleOf')).toBe(true);
    });

    it('accepts weight that is multipleOf 0.01', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, weight: 1.25 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects rating above maximum (5)', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ ...validProduct, rating: 5.1 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
    });

    it('rejects event score at exclusiveMaximum boundary (100)', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{ id: 1, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: true, score: 100 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'exclusiveMaximum')).toBe(true);
    });

    it('accepts event score just below exclusiveMaximum', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{ id: 1, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: true, score: 99.9 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects float value for integer field', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{ id: 1.5, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: true }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'type')).toBe(true);
    });
  });

  // ── boolean ───────────────────────────────────────────────────────
  describe('boolean', () => {
    it('accepts true / false for boolean field', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: false, category: 'food' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects string value for boolean field', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: 'yes', category: 'food' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'type')).toBe(true);
    });

    it('rejects number value for boolean field', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{ id: 1, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: 1 }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
    });
  });

  // ── enum ──────────────────────────────────────────────────────────
  describe('enum', () => {
    it('accepts a valid enum value', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'EUR', inStock: true, category: 'books' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects invalid enum value for currency', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'BTC', inStock: true, category: 'electronics' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'enum')).toBe(true);
    });

    it('rejects invalid enum value for category', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'furniture' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'enum')).toBe(true);
    });

    it('rejects invalid enum value for event status', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{ id: 1, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: true, status: 'deleted' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'enum')).toBe(true);
    });
  });

  // ── array: minItems, maxItems, uniqueItems ────────────────────────
  describe('array constraints', () => {
    it('rejects empty events array (minItems: 1)', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'minItems')).toBe(true);
    });

    it('accepts a single event (meets minItems: 1)', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{ id: 1, name: 'Event One', startDate: '2026-03-31T12:00:00Z', active: true }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects tags array exceeding maxItems (10)', () => {
      const tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          tags,
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'maxItems')).toBe(true);
    });

    it('rejects duplicate items when uniqueItems is true (tags)', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          tags: ['sale', 'sale'],
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'uniqueItems')).toBe(true);
    });

    it('accepts unique tags within maxItems', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          tags: ['sale', 'new', 'featured'],
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects event attendees with duplicate emails (uniqueItems)', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{
          id: 1, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: true,
          attendees: ['a@test.com', 'a@test.com'],
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'uniqueItems')).toBe(true);
    });

    it('rejects empty attendees array (minItems: 1)', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{
          id: 1, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: true,
          attendees: [],
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'minItems')).toBe(true);
    });
  });

  // ── additionalProperties ──────────────────────────────────────────
  describe('additionalProperties', () => {
    it('rejects extra properties on Settings (additionalProperties: false)', () => {
      const mocks = makeMock('GET:/api/v1/settings:200', {
        alias: 'getSettings', url: '/api/v1/settings', method: 'GET', status: 200,
        response: { theme: 'dark', notifications: true, language: 'en', extraField: 'oops' },
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'additionalProperties')).toBe(true);
    });

    it('accepts Settings with only defined properties', () => {
      const mocks = makeMock('GET:/api/v1/settings:200', {
        alias: 'getSettings', url: '/api/v1/settings', method: 'GET', status: 200,
        response: { theme: 'light', notifications: false, language: 'en-US' },
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('accepts Product metadata with string additionalProperties', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          metadata: { color: 'red', size: 'large' },
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects Product metadata with non-string additionalProperties value', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          metadata: { color: 'red', count: 5 },
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
      expect(results[0].validation.errors.some(e => e.keyword === 'type')).toBe(true);
    });
  });

  // ── nullable ──────────────────────────────────────────────────────
  describe('nullable', () => {
    it('accepts null for nullable description field', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          description: null,
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('accepts string value for nullable description field', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          description: 'A nice widget',
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects number value for nullable string field', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          description: 123,
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
    });

    it('accepts null for nullable compareAtPrice (number)', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          compareAtPrice: null,
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('accepts numeric value for nullable compareAtPrice', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000', name: 'W', price: 1, currency: 'USD', inStock: true, category: 'electronics',
          compareAtPrice: 19.99,
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('accepts null for nullable event endDate', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{ id: 1, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: true, endDate: null }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('accepts valid date-time string for nullable event endDate', () => {
      const mocks = makeMock('GET:/api/v1/events:200', {
        alias: 'getEvents', url: '/api/v1/events', method: 'GET', status: 200,
        response: [{ id: 1, name: 'Event', startDate: '2026-03-31T12:00:00Z', active: true, endDate: '2026-04-01T12:00:00Z' }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('accepts null for nullable Settings customCss', () => {
      const mocks = makeMock('GET:/api/v1/settings:200', {
        alias: 'getSettings', url: '/api/v1/settings', method: 'GET', status: 200,
        response: { theme: 'auto', notifications: true, language: 'es', customCss: null },
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });

    it('rejects non-null non-string for nullable string Settings customCss', () => {
      const mocks = makeMock('GET:/api/v1/settings:200', {
        alias: 'getSettings', url: '/api/v1/settings', method: 'GET', status: 200,
        response: { theme: 'auto', notifications: true, language: 'es', customCss: 42 },
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(false);
    });
  });

  // ── combined: full valid product ──────────────────────────────────
  describe('full valid product with all optional fields', () => {
    it('accepts a complete product with all fields valid', () => {
      const mocks = makeMock('GET:/api/v1/products:200', {
        alias: 'getProducts', url: '/api/v1/products', method: 'GET', status: 200,
        response: [{
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Premium Widget',
          sku: 'ABCD-12345678',
          description: 'The best widget',
          price: 49.99,
          compareAtPrice: 59.99,
          quantity: 100,
          weight: 2.50,
          rating: 4.5,
          inStock: true,
          currency: 'GBP',
          category: 'toys',
          tags: ['new', 'featured'],
          createdAt: '2026-03-31T10:00:00Z',
          releaseDate: '2026-04-01',
          website: 'https://widgets.example.com',
          contactEmail: 'sales@widgets.example.com',
          origin: 'widgets.example.com',
          serverIp: '10.0.0.1',
          serverIpV6: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
          metadata: { color: 'blue', material: 'steel' },
        }],
      });
      const { results } = validateMocks(mocks, contracts);
      expect(results[0].validation.valid).toBe(true);
    });
  });
});
