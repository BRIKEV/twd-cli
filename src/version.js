import fs from 'fs';

// null under a mocked fs or a broken install; the report treats it as unknown.
export function cliVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version ?? null;
  } catch {
    return null;
  }
}
