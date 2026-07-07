const NET_ERRORS = ['ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED', 'ERR_ADDRESS_UNREACHABLE'];

export function isProtocolTimeout(error) {
  const message = error && error.message ? error.message : '';
  return (
    (error && error.name === 'ProtocolError' && /timed out/i.test(message)) ||
    /protocolTimeout/i.test(message)
  );
}

export function explainError(error, config = {}) {
  if (!error || typeof error.message !== 'string') return null;
  const message = error.message;

  const netMatch = message.match(/net::(ERR_[A-Z_]+)/);
  if (netMatch && NET_ERRORS.includes(netMatch[1])) {
    return (
      `Could not reach ${config.url} (${netMatch[1]}).\n` +
      'Is your dev server running? Start it (e.g. `npm run dev`) or fix "url" in twd.config.json.'
    );
  }

  if (error.name === 'TimeoutError' && message.includes('#twd-sidebar-root')) {
    return (
      `Page loaded but the TWD sidebar (#twd-sidebar-root) did not appear within ${config.timeout}ms.\n` +
      'Ensure twd-js is initialized in your app and your tests are registered.\n' +
      'If the app is slow to start, raise "timeout" in twd.config.json.'
    );
  }

  if (isProtocolTimeout(error)) {
    return (
      'This looks like a Puppeteer protocolTimeout. The whole test suite runs in a single\n' +
      'page.evaluate call, so the run aborts if it takes longer than "protocolTimeout" (ms).\n' +
      'Raise it in twd.config.json, e.g. { "protocolTimeout": 600000 } (0 = no timeout).'
    );
  }

  if (/Could not find Chrome|Failed to launch the browser process/.test(message)) {
    return (
      'Puppeteer could not launch Chrome.\n' +
      'Run `npx puppeteer browsers install chrome`, or adjust "puppeteerArgs" in twd.config.json.'
    );
  }

  return null;
}
