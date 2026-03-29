import fs from 'fs';
import path from 'path';
import { OpenAPIMockValidator } from 'openapi-mock-validator';

export async function loadContracts(contracts, workingDir) {
  const loaded = [];

  for (const contract of contracts) {
    const sourcePath = path.resolve(workingDir, contract.source);

    let specJson;
    try {
      const raw = fs.readFileSync(sourcePath, 'utf-8');
      specJson = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn(`Could not read ${contract.source}: file not found`);
      } else if (err instanceof SyntaxError) {
        console.warn(`Could not parse ${contract.source}: invalid JSON`);
      } else {
        console.warn(`Could not read ${contract.source}: ${err.message}`);
      }
      continue;
    }

    try {
      const validator = new OpenAPIMockValidator(specJson);
      await validator.init();
      loaded.push({
        validator,
        source: contract.source,
        baseUrl: contract.baseUrl || '/',
        mode: contract.mode || 'warn',
        strict: contract.strict !== undefined ? contract.strict : true,
      });
    } catch (err) {
      console.warn(`Could not initialize validator for ${contract.source}: ${err.message}`);
    }
  }

  return loaded;
}
