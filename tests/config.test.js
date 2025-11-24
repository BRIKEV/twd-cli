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
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: Could not parse twd.config.json'),
      expect.any(String)
    );

    consoleWarnSpy.mockRestore();
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
});