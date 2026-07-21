// The handler enumeration preserves insertion order, and twd registers each
// suite before its children, so filtering to tests yields pre-order execution
// order — the same order runByIds/runAll walk the tree in.
export function orderedTestIds(handlers) {
  return handlers.filter((h) => h.type === 'test').map((h) => h.id);
}

// Split items into contiguous slices of `size`. size <= 0 means "one chunk".
export function chunk(items, size) {
  if (size <= 0) return items.length ? [items.slice()] : [];
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
