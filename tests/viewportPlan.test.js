import { describe, it, expect } from 'vitest';
import { sizeForViewport, namesAtWidth, planViewportPasses } from '../src/viewportPlan.js';

const VIEWPORTS = {
  mobile: { maxWidth: 767 },
  tablet: { minWidth: 768, maxWidth: 1023 },
  desktop: { minWidth: 1024 },
};
const BASE = { width: 1280, height: 800, deviceScaleFactor: 1 };

describe('sizeForViewport', () => {
  it('uses maxWidth, keeping the base height and scale', () => {
    expect(sizeForViewport(VIEWPORTS.mobile, BASE)).toEqual({ width: 767, height: 800, deviceScaleFactor: 1 });
    expect(sizeForViewport(VIEWPORTS.tablet, BASE)).toEqual({ width: 1023, height: 800, deviceScaleFactor: 1 });
  });

  it('uses minWidth when the range has no maximum', () => {
    expect(sizeForViewport(VIEWPORTS.desktop, { ...BASE, width: 900 }).width).toBe(1024);
  });

  it('keeps the base width when it is already inside the range', () => {
    expect(sizeForViewport(VIEWPORTS.desktop, BASE).width).toBe(1280);
  });

  it('lets an override win, merged over the derived size', () => {
    expect(sizeForViewport(VIEWPORTS.mobile, BASE, { width: 390, height: 844 })).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
    });
    expect(sizeForViewport(VIEWPORTS.mobile, BASE, { width: 390 })).toEqual({
      width: 390,
      height: 800,
      deviceScaleFactor: 1,
    });
  });
});

describe('namesAtWidth', () => {
  it('lists the declared viewports a width falls in, in registry order', () => {
    expect(namesAtWidth(VIEWPORTS, 1280)).toEqual(['desktop']);
    expect(namesAtWidth(VIEWPORTS, 767)).toEqual(['mobile']);
    expect(namesAtWidth({ a: { maxWidth: 900 }, b: { minWidth: 800 } }, 850)).toEqual(['a', 'b']);
    expect(namesAtWidth({ mobile: { maxWidth: 767 }, desktop: { minWidth: 1024 } }, 900)).toEqual([]);
  });
});

describe('planViewportPasses', () => {
  // Ids are in run order; scopes are what twd-js viewportScope() returned.
  const selectedIds = ['plain', 'nav', 'burger', 'cards', 'typo'];
  const currentScope = ['plain', 'nav'];
  const namedScopes = {
    mobile: ['plain', 'burger', 'cards'],
    tablet: ['plain', 'cards'],
    desktop: ['plain', 'nav'],
  };

  it('runs each test once: the base size first, then each viewport in registry order', () => {
    const plan = planViewportPasses({ selectedIds, currentScope, namedScopes, viewports: VIEWPORTS, base: BASE });
    expect(plan.passes).toEqual([
      { name: 'desktop', size: null, ids: ['plain', 'nav'] },
      { name: 'mobile', size: { width: 767, height: 800, deviceScaleFactor: 1 }, ids: ['burger', 'cards'] },
    ]);
    // tablet only had tests that already ran, so its pass is dropped.
    expect(plan.unmatched).toEqual(['typo']);
  });

  it('keeps the selection order inside each pass and ignores unselected ids', () => {
    const plan = planViewportPasses({
      selectedIds: ['cards', 'burger'],
      currentScope,
      namedScopes,
      viewports: VIEWPORTS,
      base: BASE,
    });
    expect(plan.passes).toEqual([
      { name: 'mobile', size: { width: 767, height: 800, deviceScaleFactor: 1 }, ids: ['cards', 'burger'] },
    ]);
    expect(plan.unmatched).toEqual([]);
  });

  it('names the base pass null when the base width matches no viewport', () => {
    const plan = planViewportPasses({
      selectedIds: ['plain'],
      currentScope: ['plain'],
      namedScopes: { mobile: ['plain'], desktop: ['plain'] },
      viewports: { mobile: { maxWidth: 767 }, desktop: { minWidth: 1024 } },
      base: { ...BASE, width: 900 },
    });
    expect(plan.passes).toEqual([{ name: null, size: null, ids: ['plain'] }]);
  });

  it('applies viewportSizes overrides to later passes', () => {
    const plan = planViewportPasses({
      selectedIds,
      currentScope,
      namedScopes,
      viewports: VIEWPORTS,
      base: BASE,
      overrides: { mobile: { width: 390, height: 844 } },
    });
    expect(plan.passes[1].size).toEqual({ width: 390, height: 844, deviceScaleFactor: 1 });
  });
});
