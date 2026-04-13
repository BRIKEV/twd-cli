import { describe, it, expect } from 'vitest';
import { buildTestPath } from '../src/buildTestPath.js';

describe('buildTestPath', () => {
  it('returns full path for nested test: Outer > Inner > test name', () => {
    const handlers = [
      { id: 'suite-1', name: 'Cart', type: 'suite', children: ['suite-2'], depth: 0 },
      { id: 'suite-2', name: 'Checkout', type: 'suite', parent: 'suite-1', children: ['test-1'], depth: 1 },
      { id: 'test-1', name: 'should submit order', type: 'test', parent: 'suite-2', depth: 2 },
    ];

    expect(buildTestPath('test-1', handlers)).toBe('Cart > Checkout > should submit order');
  });

  it('returns single-level path: Suite > test name', () => {
    const handlers = [
      { id: 'suite-1', name: 'Users', type: 'suite', children: ['test-1'], depth: 0 },
      { id: 'test-1', name: 'should load list', type: 'test', parent: 'suite-1', depth: 1 },
    ];

    expect(buildTestPath('test-1', handlers)).toBe('Users > should load list');
  });

  it('returns just test name when no parent suite', () => {
    const handlers = [
      { id: 'test-1', name: 'standalone test', type: 'test', depth: 0 },
    ];

    expect(buildTestPath('test-1', handlers)).toBe('standalone test');
  });

  it('returns null when testId is not found in handlers', () => {
    const handlers = [
      { id: 'test-1', name: 'some test', type: 'test', depth: 0 },
    ];

    expect(buildTestPath('nonexistent', handlers)).toBeNull();
  });
});
