import { describe, it, expect } from 'vitest';
import { explainError, isProtocolTimeout } from '../src/diagnostics.js';

const config = { url: 'http://localhost:5173', timeout: 10000 };

describe('explainError', () => {
  it('explains connection refused with the configured url', () => {
    const err = new Error('net::ERR_CONNECTION_REFUSED at http://localhost:5173');
    const msg = explainError(err, config);
    expect(msg).toContain('Could not reach http://localhost:5173 (ERR_CONNECTION_REFUSED)');
    expect(msg).toContain('Is your dev server running?');
    expect(msg).toContain('"url" in twd.config.json');
  });

  it('explains DNS resolution failures', () => {
    const err = new Error('net::ERR_NAME_NOT_RESOLVED at http://myapp.local:5173');
    const msg = explainError(err, { ...config, url: 'http://myapp.local:5173' });
    expect(msg).toContain('Could not reach http://myapp.local:5173 (ERR_NAME_NOT_RESOLVED)');
  });

  it('explains unreachable-address failures', () => {
    const err = new Error('net::ERR_ADDRESS_UNREACHABLE at http://10.0.0.9:5173');
    expect(explainError(err, config)).toContain('(ERR_ADDRESS_UNREACHABLE)');
  });

  it('explains the sidebar selector timeout with the configured timeout', () => {
    const err = new Error(
      "Waiting for selector '#twd-sidebar-root' failed: Waiting failed: 10000ms exceeded"
    );
    err.name = 'TimeoutError';
    const msg = explainError(err, config);
    expect(msg).toContain('TWD sidebar (#twd-sidebar-root) did not appear within 10000ms');
    expect(msg).toContain('Ensure twd-js is initialized');
    expect(msg).toContain('raise "timeout" in twd.config.json');
  });

  it('does not claim a sidebar problem for unrelated TimeoutErrors', () => {
    const err = new Error('Waiting for selector ".other-thing" failed');
    err.name = 'TimeoutError';
    expect(explainError(err, config)).toBeNull();
  });

  it('explains protocol timeouts', () => {
    const err = new Error('Runtime.callFunctionOn timed out.');
    err.name = 'ProtocolError';
    const msg = explainError(err, config);
    expect(msg).toContain('protocolTimeout');
    expect(msg).toContain('twd.config.json');
  });

  it('explains a missing Chrome install', () => {
    const err = new Error('Could not find Chrome (ver. 131.0.6778.204).');
    const msg = explainError(err, config);
    expect(msg).toContain('Puppeteer could not launch Chrome');
    expect(msg).toContain('npx puppeteer browsers install chrome');
  });

  it('explains a browser process launch failure', () => {
    const err = new Error('Failed to launch the browser process!\nspawn ENOENT');
    const msg = explainError(err, config);
    expect(msg).toContain('Puppeteer could not launch Chrome');
    expect(msg).toContain('"puppeteerArgs" in twd.config.json');
  });

  it('returns null for unknown errors', () => {
    expect(explainError(new Error('something else entirely'), config)).toBeNull();
  });

  it('tolerates a missing config and non-Error values', () => {
    const err = new Error('net::ERR_CONNECTION_REFUSED at http://localhost:5173');
    expect(explainError(err)).toContain('Could not reach undefined (ERR_CONNECTION_REFUSED)');
    expect(explainError(null, config)).toBeNull();
    expect(explainError('boom', config)).toBeNull();
  });
});

describe('isProtocolTimeout', () => {
  it('matches ProtocolError timeouts', () => {
    const err = new Error('Runtime.callFunctionOn timed out.');
    err.name = 'ProtocolError';
    expect(isProtocolTimeout(err)).toBe(true);
  });

  it('matches messages that mention protocolTimeout', () => {
    expect(isProtocolTimeout(new Error('Increase the protocolTimeout setting'))).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isProtocolTimeout(new Error('boom'))).toBe(false);
    expect(isProtocolTimeout(null)).toBe(false);
  });
});
