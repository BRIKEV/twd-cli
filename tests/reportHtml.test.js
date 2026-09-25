import { describe, it, expect } from 'vitest';
import { renderHtml } from '../src/reportHtml.js';
import { report, contractResult, invalid } from './reportFixtures.js';

describe('renderHtml', () => {
  it('is one self-contained document', () => {
    const html = renderHtml(report());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<link|<script src|https?:\/\/(?!localhost)/);
  });

  it('shows the verdict and counts', () => {
    const html = renderHtml(report({ tests: [
      { id: 't1', status: 'pass' },
      { id: 't2', status: 'pass' },
      { id: 't3', status: 'fail', error: 'e' }
    ]}));
    expect(html).toContain('class="badge failed">FAILED<');
    expect(html).toMatch(/<b>2<\/b> passed/);
    expect(html).toMatch(/<b>1<\/b> failed/);
  });

  it('has no needs-attention section on a green run', () => {
    const html = renderHtml(report());
    expect(html).toContain('class="badge passed">PASSED<');
    expect(html).not.toContain('Needs attention');
  });

  it('puts a contract error next to test failures', () => {
    const html = renderHtml(report({ contracts: { results: [contractResult({ validation: invalid() })] } }));
    expect(html).toContain('Needs attention (1)');
    expect(html).toContain('GET /invoices 200');
    expect(html).toContain('used by Invoices &gt; loads');
  });

  it('embeds a snapshot diff from images', () => {
    const html = renderHtml(
      report({ snapshots: [{ name: 'form', file: 'snapshots/form.failed.png' }] }),
      { images: { 'snapshots/form.failed.png': 'data:image/png;base64,AAAA' } },
    );
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it('says so when a snapshot image could not be read', () => {
    const html = renderHtml(report({ snapshots: [{ name: 'form', file: 'snapshots/form.failed.png' }] }));
    expect(html).toContain('could not be read');
  });

  it('links a per-test recording with a relative path', () => {
    const html = renderHtml(report({ tests: [{ id: 't1', status: 'fail', error: 'e', recording: 'recordings/a.mp4' }] }));
    expect(html).toContain('<video controls preload="none" src="recordings/a.mp4">');
  });

  it('escapes author-controlled text', () => {
    const handlers = [{ id: 'h', name: '<script>alert(1)</script>', parent: null, type: 'test' }];
    const html = renderHtml(report({ handlers, allTestIds: ['h'], executed: 1, tests: [{ id: 'h', status: 'fail', error: '<b>x</b>' }] }));
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('shows the error and diagnostic for an interrupted run', () => {
    const html = renderHtml(report({ tests: [], executed: 0, error: { message: 'boom', diagnostic: 'Is your dev server running?' } }));
    expect(html).toContain('class="badge interrupted">INTERRUPTED<');
    expect(html).toContain('boom');
    expect(html).toContain('Is your dev server running?');
  });

  it('lists every test in the collapsed section', () => {
    const html = renderHtml(report());
    expect(html).toContain('All tests (3)');
    expect(html).toContain('Invoices &gt; loads');
  });

  it('groups contract warnings by spec', () => {
    const html = renderHtml(report({
      contracts: {
        results: [
          contractResult({
            specSource: 'openapi.json',
            mode: 'warn',
            validation: { valid: true, errors: [], warnings: [{ message: 'type mismatch' }] }
          }),
          contractResult({
            specSource: 'asyncapi.json',
            mode: 'warn',
            validation: { valid: true, errors: [], warnings: [{ message: 'missing field' }] }
          })
        ]
      }
    }));
    expect(html).toContain('openapi.json');
    expect(html).toContain('asyncapi.json');
    expect(html).toContain('type mismatch');
    expect(html).toContain('missing field');
  });
});
