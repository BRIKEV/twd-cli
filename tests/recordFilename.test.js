import { describe, it, expect } from "vitest";
import { slugify, resolveRecordFilename } from "../src/recordFilename.js";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumerics to single hyphens", () => {
    expect(slugify('Login > shows error on bad password'))
      .toBe('login-shows-error-on-bad-password');
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify('  >>> Checkout <<<  ')).toBe('checkout');
  });

  it("truncates long paths without leaving a trailing hyphen", () => {
    const slug = slugify('a'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugify('>>> <<<')).toBe('');
  });
});

describe("resolveRecordFilename", () => {
  it("slugifies the single recorded test path", () => {
    expect(resolveRecordFilename({
      testNames: ['Login > shows error on bad password'],
      filename: null,
      format: 'mp4',
    })).toBe('login-shows-error-on-bad-password.mp4');
  });

  it("uses run.<ext> when more than one test is recorded", () => {
    expect(resolveRecordFilename({
      testNames: ['Login > a', 'Login > b'],
      filename: null,
      format: 'webm',
    })).toBe('run.webm');
  });

  it("uses run.<ext> when no tests are recorded", () => {
    expect(resolveRecordFilename({ testNames: [], filename: null, format: 'mp4' }))
      .toBe('run.mp4');
  });

  it("falls back to run.<ext> when the single test slugifies to nothing", () => {
    expect(resolveRecordFilename({ testNames: ['>>>'], filename: null, format: 'mp4' }))
      .toBe('run.mp4');
  });

  it("honours an explicit filename and appends the format extension", () => {
    expect(resolveRecordFilename({ testNames: [], filename: 'demo', format: 'mp4' }))
      .toBe('demo.mp4');
  });

  it("leaves an explicit filename alone when it already has a known extension", () => {
    expect(resolveRecordFilename({ testNames: [], filename: 'demo.webm', format: 'mp4' }))
      .toBe('demo.webm');
  });

  it("does not mistake a dot in the name for an extension", () => {
    expect(resolveRecordFilename({ testNames: [], filename: 'v1.2-demo', format: 'mp4' }))
      .toBe('v1.2-demo.mp4');
  });
});
