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

export function validateMocks(collectedMocks, contracts) {
  const results = [];
  const skipped = [];

  for (const [, mock] of collectedMocks) {
    if (mock.urlRegex) {
      skipped.push({ alias: mock.alias, url: mock.url, reason: 'urlRegex mock' });
      continue;
    }

    let matched = false;

    for (const contract of contracts) {
      if (!mock.url.startsWith(contract.baseUrl)) {
        continue;
      }

      const strippedUrl = contract.baseUrl === '/'
        ? mock.url
        : mock.url.slice(contract.baseUrl.length);

      const pathMatch = contract.validator.matchPath(strippedUrl, mock.method);
      if (!pathMatch) {
        continue;
      }

      const validation = contract.validator.validateResponse(
        pathMatch.path,
        mock.method,
        mock.status,
        mock.response,
        { strict: contract.strict },
      );

      results.push({
        alias: mock.alias,
        url: mock.url,
        method: mock.method,
        status: mock.status,
        specSource: contract.source,
        matchedPath: pathMatch.path,
        mode: contract.mode,
        testName: mock.testName,
        occurrence: mock.occurrence,
        validation,
      });

      matched = true;
      break;
    }

    if (!matched) {
      skipped.push({ alias: mock.alias, url: mock.url, reason: 'no matching contract' });
    }
  }

  return { results, skipped };
}
