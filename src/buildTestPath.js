export function buildTestPath(testId, handlers) {
  const handlerMap = new Map(handlers.map(h => [h.id, h]));
  const parts = [];
  let current = handlerMap.get(testId);
  if (!current) return null;
  while (current) {
    parts.unshift(current.name);
    current = current.parent ? handlerMap.get(current.parent) : null;
  }
  return parts.join(' > ');
}
