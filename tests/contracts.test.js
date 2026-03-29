import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadContracts } from '../src/contracts.js';

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
