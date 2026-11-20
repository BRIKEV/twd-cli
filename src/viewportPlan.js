// Responsive runs: one pass per viewport, each test once.
//
// The app declares named viewports in twd-js (`{ mobile: { maxWidth: 767 } }`)
// and tags tests with them. In the browser, Run All only runs what matches the
// window width, so a single fixed-size CI run would never reach the mobile
// tests. These helpers turn what the page reports into an ordered plan: the
// tests in scope at the configured size first, then one pass per remaining
// viewport at a size derived from its range. Which test belongs to which
// viewport is always twd-js's answer (`viewportScope()`), never computed here.

const inRange = ({ minWidth, maxWidth }, width) =>
  (minWidth === undefined || width >= minWidth) && (maxWidth === undefined || width <= maxWidth);

/**
 * The size a viewport's pass runs at. The base width when it is already in the
 * range, otherwise the range's maxWidth, otherwise its minWidth. Height and
 * deviceScaleFactor come from the base. An override from `viewportSizes`
 * is merged over the result, so `{ width: 390 }` keeps the base height.
 */
export function sizeForViewport(definition, base, override = {}) {
  const width = inRange(definition, base.width)
    ? base.width
    : (definition.maxWidth ?? definition.minWidth);
  return { ...base, width, ...override };
}

/** Declared viewports a width falls in, in registry order. */
export function namesAtWidth(viewports, width) {
  return Object.entries(viewports)
    .filter(([, definition]) => inRange(definition, width))
    .map(([name]) => name);
}

/**
 * @param selectedIds  ids to run, in run order (after filters and shards)
 * @param currentScope ids twd-js runs at the base size (`viewportScope()`)
 * @param namedScopes  `{ name: ids }` from `viewportScope({ viewport: name })`
 * @param viewports    the app's registry, in declaration order
 * @param base         the size the page is at now
 * @param overrides    `viewportSizes` from twd.config.json
 * @returns `{ passes: [{ name, size, ids }], unmatched: ids }`. `size` is null
 *   for the base pass, which needs no resize. `name` joins the viewports the
 *   base width falls in, or is null when it falls in none. Empty passes are
 *   dropped. `unmatched` are tests no declared viewport takes.
 */
export function planViewportPasses({ selectedIds, currentScope, namedScopes, viewports, base, overrides = {} }) {
  const assigned = new Set();
  const take = (scope) => {
    const inScope = new Set(scope);
    const ids = selectedIds.filter((id) => inScope.has(id) && !assigned.has(id));
    for (const id of ids) assigned.add(id);
    return ids;
  };

  const passes = [];
  const baseNames = namesAtWidth(viewports, base.width);
  const baseIds = take(currentScope);
  if (baseIds.length > 0) {
    passes.push({ name: baseNames.length ? baseNames.join(', ') : null, size: null, ids: baseIds });
  }

  for (const [name, definition] of Object.entries(viewports)) {
    const ids = take(namedScopes[name] ?? []);
    if (ids.length === 0) continue;
    passes.push({ name, size: sizeForViewport(definition, base, overrides[name]), ids });
  }

  return { passes, unmatched: selectedIds.filter((id) => !assigned.has(id)) };
}
