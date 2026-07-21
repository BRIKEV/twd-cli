import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

describe('loadConfig', () => {
  const mockCwd = '/mock/project';
  const originalCwd = process.cwd;

  beforeEach(() => {
    process.cwd = vi.fn(() => mockCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('should load default config when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadConfig();

    expect(config).toEqual({
      url: 'http://localhost:5173',
      timeout: 10000,
      coverage: true,
      coverageDir: './coverage',
      nycOutputDir: './.nyc_output',
      headless: true,
      puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
      retryCount: 2,
      protocolTimeout: 300000,
      maxFailures: 10,
      chunkSize: 10,
    });
    expect(fs.existsSync).toHaveBeenCalledWith(path.resolve(mockCwd, 'twd.config.json'));
  });

  it('should merge user config with defaults when config file exists', () => {
    const userConfig = {
      url: 'http://localhost:3000',
      coverage: false,
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(userConfig));

    const config = loadConfig();

    expect(config).toEqual({
      url: 'http://localhost:3000',
      timeout: 10000,
      coverage: false,
      coverageDir: './coverage',
      nycOutputDir: './.nyc_output',
      headless: true,
      puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
      retryCount: 2,
      protocolTimeout: 300000,
      maxFailures: 10,
      chunkSize: 10,
    });
    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.resolve(mockCwd, 'twd.config.json'),
      'utf-8'
    );
  });

  it('should override all default values when user provides full config', () => {
    const userConfig = {
      url: 'http://localhost:8080',
      timeout: 20000,
      coverage: false,
      coverageDir: './custom-coverage',
      nycOutputDir: './custom-nyc',
      headless: false,
      puppeteerArgs: ['--disable-dev-shm-usage'],
      retryCount: 3,
      protocolTimeout: 600000,
      maxFailures: 5,
      chunkSize: 20,
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(userConfig));

    const config = loadConfig();

    expect(config).toEqual(userConfig);
  });

  it('should return defaults and warn when config file has invalid JSON', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');

    const config = loadConfig();

    expect(config).toEqual({
      url: 'http://localhost:5173',
      timeout: 10000,
      coverage: true,
      coverageDir: './coverage',
      nycOutputDir: './.nyc_output',
      headless: true,
      puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
      retryCount: 2,
      protocolTimeout: 300000,
      maxFailures: 10,
      chunkSize: 10,
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: Could not parse twd.config.json'),
      expect.any(String)
    );

    consoleWarnSpy.mockRestore();
  });

  it('should allow user to configure retryCount', () => {
    const userConfig = {
      retryCount: 3,
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(userConfig));

    const config = loadConfig();

    expect(config.retryCount).toBe(3);
    expect(config.url).toBe('http://localhost:5173');
  });

  it('should default protocolTimeout and allow user override', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loadConfig().protocolTimeout).toBe(300000);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ protocolTimeout: 0 }));
    expect(loadConfig().protocolTimeout).toBe(0);
  });

  it('should handle partial user config correctly', () => {
    const userConfig = {
      headless: false,
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(userConfig));

    const config = loadConfig();

    expect(config.headless).toBe(false);
    expect(config.url).toBe('http://localhost:5173');
    expect(config.timeout).toBe(10000);
  });

  it('defaults maxFailures to 10 and chunkSize to 10', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config.maxFailures).toBe(10);
    expect(config.chunkSize).toBe(10);
  });

  it('allows user to override maxFailures and chunkSize (0 disables bail)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ maxFailures: 0, chunkSize: 25 })
    );
    const config = loadConfig();
    expect(config.maxFailures).toBe(0);
    expect(config.chunkSize).toBe(25);
  });
});