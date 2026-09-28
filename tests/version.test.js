import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cliVersion } from '../src/version.js';

describe('cliVersion', () => {
  it('reads the version from package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    expect(cliVersion()).toBe(pkg.version);
  });
});
