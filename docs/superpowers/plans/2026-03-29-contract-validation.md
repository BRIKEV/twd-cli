# twd-cli Contract Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add contract validation to twd-cli — validate mockRequest responses against OpenAPI specs after tests complete, print a formatted report, and optionally fail CI.

**Architecture:** twd-cli registers `page.exposeFunction('__twdCollectMock')` to collect mocks during test execution. After tests complete, it validates each collected mock against the matching OpenAPI spec using `openapi-mock-validator`. Results are printed as a formatted report. Exit code reflects both test failures and contract errors.

**Tech Stack:** Plain JS (ESM), Vitest, openapi-mock-validator (file: reference), Puppeteer page.exposeFunction

---

## File Structure

```
/Users/kevinccbsg/brikev/twd-cli/
├── src/
│   ├── index.js          # MODIFY: wire exposeFunction, call contract validation after tests
│   ├── config.js          # NO CHANGES
│   ├── contracts.js       # NEW: loadContracts(), validateMocks()
│   └── contractReport.js  # NEW: printContractReport()
├── tests/
│   ├── contracts.test.js       # NEW
│   ├── contractReport.test.js  # NEW
│   ├── runTests.test.js        # MODIFY: add contract integration tests
│   ├── config.test.js          # NO CHANGES
│   └── fixtures/
│       └── petstore-3.0.json   # NEW: test fixture
├── package.json           # MODIFY: add openapi-mock-validator dependency
└── ...
```

---

### Task 1: Add openapi-mock-validator Dependency

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/package.json`

- [ ] **Step 1: Add the file: dependency**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npm install openapi-mock-validator@file:../openapi-mock-validator
```

- [ ] **Step 2: Verify it installed**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
node -e "import('openapi-mock-validator').then(m => console.log('OK:', Object.keys(m)))"
```

Expected: `OK: [ 'OpenAPIMockValidator' ]`

- [ ] **Step 3: Commit**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add package.json package-lock.json
git commit -m "chore: add openapi-mock-validator dependency (file reference)"
```

---

### Task 2: Create Test Fixture

**Files:**
- Create: `/Users/kevinccbsg/brikev/twd-cli/tests/fixtures/petstore-3.0.json`

- [ ] **Step 1: Create the fixture**

Write `/Users/kevinccbsg/brikev/twd-cli/tests/fixtures/petstore-3.0.json`:

```json
{
  "openapi": "3.0.0",
  "info": { "title": "Petstore", "version": "1.0.0" },
  "paths": {
    "/v1/pets": {
      "get": {
        "responses": {
          "200": {
            "description": "List of pets",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                      "id": { "type": "integer" },
                      "name": { "type": "string" },
                      "tag": { "type": "string" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["name"],
                "properties": {
                  "name": { "type": "string" },
                  "tag": { "type": "string" }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Pet created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": ["id", "name"],
                  "properties": {
                    "id": { "type": "integer" },
                    "name": { "type": "string" },
                    "tag": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/pets/{petId}": {
      "get": {
        "responses": {
          "200": {
            "description": "A pet",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": ["id", "name"],
                  "properties": {
                    "id": { "type": "integer" },
                    "name": { "type": "string" },
                    "tag": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add tests/fixtures/petstore-3.0.json
git commit -m "test: add petstore OpenAPI fixture for contract tests"
```

---

### Task 3: Implement contracts.js — loadContracts

**Files:**
- Create: `/Users/kevinccbsg/brikev/twd-cli/src/contracts.js`
- Create: `/Users/kevinccbsg/brikev/twd-cli/tests/contracts.test.js`

- [ ] **Step 1: Write failing tests for loadContracts**

Write `/Users/kevinccbsg/brikev/twd-cli/tests/contracts.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadContracts, validateMocks } from '../src/contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('loadContracts', () => {
  let consoleWarnSpy;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('loads a valid spec file and returns initialized validator', async () => {
    const contracts = [{ source: './tests/fixtures/petstore-3.0.json' }];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result).toHaveLength(1);
    expect(result[0].validator).toBeDefined();
    expect(result[0].baseUrl).toBe('/');
    expect(result[0].mode).toBe('warn');
    expect(result[0].strict).toBe(true);
  });

  it('applies custom baseUrl, mode, and strict from config', async () => {
    const contracts = [{
      source: './tests/fixtures/petstore-3.0.json',
      baseUrl: '/api',
      mode: 'error',
      strict: false,
    }];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result[0].baseUrl).toBe('/api');
    expect(result[0].mode).toBe('error');
    expect(result[0].strict).toBe(false);
  });

  it('warns and skips when source file does not exist', async () => {
    const contracts = [{ source: './nonexistent.json' }];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not read')
    );
  });

  it('warns and skips when source file is invalid JSON', async () => {
    // vitest.config.js exists but is not valid JSON
    const contracts = [{ source: './vitest.config.js' }];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not parse')
    );
  });

  it('loads multiple contracts', async () => {
    const contracts = [
      { source: './tests/fixtures/petstore-3.0.json', baseUrl: '/pets' },
      { source: './tests/fixtures/petstore-3.0.json', baseUrl: '/other' },
    ];
    const result = await loadContracts(contracts, path.resolve(__dirname, '..'));

    expect(result).toHaveLength(2);
    expect(result[0].baseUrl).toBe('/pets');
    expect(result[1].baseUrl).toBe('/other');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/contracts.test.js
```

Expected: FAIL — `loadContracts` not found.

- [ ] **Step 3: Implement loadContracts**

Write `/Users/kevinccbsg/brikev/twd-cli/src/contracts.js`:

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/contracts.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/contracts.js tests/contracts.test.js
git commit -m "feat: add loadContracts — read and initialize OpenAPI validators"
```

---

### Task 4: Implement contracts.js — validateMocks

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/src/contracts.js`
- Modify: `/Users/kevinccbsg/brikev/twd-cli/tests/contracts.test.js`

- [ ] **Step 1: Write failing tests for validateMocks**

Append to `/Users/kevinccbsg/brikev/twd-cli/tests/contracts.test.js`:

```javascript
describe('validateMocks', () => {
  let loadedContracts;

  beforeEach(async () => {
    loadedContracts = await loadContracts(
      [{ source: './tests/fixtures/petstore-3.0.json', baseUrl: '/api' }],
      path.resolve(__dirname, '..'),
    );
  });

  it('validates a matching mock with valid response', () => {
    const mocks = new Map();
    mocks.set('GET:/api/v1/pets:200', {
      alias: 'getPets',
      url: '/api/v1/pets',
      method: 'GET',
      status: 200,
      response: [{ id: 1, name: 'Fido' }],
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    expect(output.results[0].validation.valid).toBe(true);
    expect(output.skipped).toHaveLength(0);
  });

  it('validates a matching mock with invalid response', () => {
    const mocks = new Map();
    mocks.set('POST:/api/v1/pets:201', {
      alias: 'createPet',
      url: '/api/v1/pets',
      method: 'POST',
      status: 201,
      response: { id: 'not-a-number', name: 'Fido' },
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    expect(output.results[0].validation.valid).toBe(false);
    expect(output.results[0].validation.errors.length).toBeGreaterThan(0);
  });

  it('strips baseUrl before matching', () => {
    const mocks = new Map();
    mocks.set('GET:/api/v1/pets/123:200', {
      alias: 'getPet',
      url: '/api/v1/pets/123',
      method: 'GET',
      status: 200,
      response: { id: 1, name: 'Fido' },
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    expect(output.results[0].matchedPath).toBe('/v1/pets/{petId}');
  });

  it('skips urlRegex mocks', () => {
    const mocks = new Map();
    mocks.set('PATCH:/regex/:200', {
      alias: 'updateOrder',
      url: '/\\/api\\/v1\\/orders\\/.*/',
      method: 'PATCH',
      status: 200,
      response: {},
      urlRegex: true,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(0);
    expect(output.skipped).toHaveLength(1);
    expect(output.skipped[0].reason).toBe('urlRegex mock');
  });

  it('skips mocks that do not match any contract baseUrl', () => {
    const mocks = new Map();
    mocks.set('POST:/external/v1/sessions:200', {
      alias: 'adyenSetup',
      url: '/external/v1/sessions',
      method: 'POST',
      status: 200,
      response: { id: 'session-1' },
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(0);
    expect(output.skipped).toHaveLength(1);
    expect(output.skipped[0].reason).toBe('no matching contract');
  });

  it('returns warning for undocumented status code', () => {
    const mocks = new Map();
    mocks.set('GET:/api/v1/pets:500', {
      alias: 'serverError',
      url: '/api/v1/pets',
      method: 'GET',
      status: 500,
      response: { error: 'boom' },
      urlRegex: false,
    });

    const output = validateMocks(mocks, loadedContracts);

    expect(output.results).toHaveLength(1);
    expect(output.results[0].validation.warnings.length).toBeGreaterThan(0);
    expect(output.results[0].validation.warnings[0].type).toBe('UNMATCHED_STATUS');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/contracts.test.js
```

Expected: FAIL — `validateMocks` not implemented.

- [ ] **Step 3: Implement validateMocks**

Add to `/Users/kevinccbsg/brikev/twd-cli/src/contracts.js` (after the `loadContracts` function):

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/contracts.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/contracts.js tests/contracts.test.js
git commit -m "feat: add validateMocks — match and validate collected mocks against specs"
```

---

### Task 5: Implement contractReport.js

**Files:**
- Create: `/Users/kevinccbsg/brikev/twd-cli/src/contractReport.js`
- Create: `/Users/kevinccbsg/brikev/twd-cli/tests/contractReport.test.js`

- [ ] **Step 1: Write failing tests**

Write `/Users/kevinccbsg/brikev/twd-cli/tests/contractReport.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printContractReport } from '../src/contractReport.js';

describe('printContractReport', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints clean report when all mocks are valid', () => {
    const output = {
      results: [
        {
          alias: 'getPets',
          url: '/api/v1/pets',
          method: 'GET',
          status: 200,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: { valid: true, errors: [], warnings: [] },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    expect(hasErrors).toBe(false);
    const logs = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(logs).toContain('All mocks match');
    expect(logs).toContain('Mocks validated: 1');
  });

  it('prints errors with ✗ symbol', () => {
    const output = {
      results: [
        {
          alias: 'createPet',
          url: '/api/v1/pets',
          method: 'POST',
          status: 201,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: {
            valid: false,
            errors: [{ path: '/id', message: 'must be integer', keyword: 'type' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    const logs = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(logs).toContain('✗');
    expect(logs).toContain('POST /v1/pets (201)');
    expect(logs).toContain('createPet');
    expect(logs).toContain('/id');
    expect(logs).toContain('Errors: 1');
  });

  it('prints warnings with ⚠ symbol', () => {
    const output = {
      results: [
        {
          alias: 'serverError',
          url: '/api/v1/pets',
          method: 'GET',
          status: 500,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: {
            valid: true,
            errors: [],
            warnings: [{ type: 'UNMATCHED_STATUS', message: 'Status 500 not documented' }],
          },
        },
      ],
      skipped: [],
    };

    printContractReport(output);

    const logs = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(logs).toContain('⚠');
    expect(logs).toContain('Warnings: 1');
  });

  it('prints skipped mocks with ℹ symbol', () => {
    const output = {
      results: [],
      skipped: [
        { alias: 'adyenSetup', url: '/external/v1/sessions', reason: 'no matching contract' },
      ],
    };

    printContractReport(output);

    const logs = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(logs).toContain('ℹ');
    expect(logs).toContain('adyenSetup');
    expect(logs).toContain('Skipped: 1');
  });

  it('returns false when mode is warn even with errors', () => {
    const output = {
      results: [
        {
          alias: 'createPet',
          method: 'POST',
          status: 201,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: {
            valid: false,
            errors: [{ path: '/id', message: 'must be integer', keyword: 'type' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    expect(hasErrors).toBe(false);
  });

  it('returns true when mode is error and has errors', () => {
    const output = {
      results: [
        {
          alias: 'createPet',
          method: 'POST',
          status: 201,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'error',
          validation: {
            valid: false,
            errors: [{ path: '/id', message: 'must be integer', keyword: 'type' }],
            warnings: [],
          },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    expect(hasErrors).toBe(true);
  });

  it('returns false when mode is error but no errors', () => {
    const output = {
      results: [
        {
          alias: 'getPets',
          method: 'GET',
          status: 200,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'error',
          validation: { valid: true, errors: [], warnings: [] },
        },
      ],
      skipped: [],
    };

    const hasErrors = printContractReport(output);

    expect(hasErrors).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/contractReport.test.js
```

Expected: FAIL — `printContractReport` not found.

- [ ] **Step 3: Implement contractReport.js**

Write `/Users/kevinccbsg/brikev/twd-cli/src/contractReport.js`:

```javascript
export function printContractReport(output) {
  const { results, skipped } = output;

  console.log('\n========================================');
  console.log('TWD Contract Validation');
  console.log('========================================');

  let errorCount = 0;
  let warningCount = 0;
  let hasContractErrors = false;

  // Group results by spec source
  const bySource = new Map();
  for (const result of results) {
    const key = result.specSource;
    if (!bySource.has(key)) {
      bySource.set(key, []);
    }
    bySource.get(key).push(result);
  }

  for (const [source, sourceResults] of bySource) {
    const mode = sourceResults[0]?.mode || 'warn';
    console.log(`Source: ${source}`);
    console.log(`Mode: ${mode}`);
    console.log('');

    for (const result of sourceResults) {
      if (!result.validation.valid) {
        errorCount += result.validation.errors.length;
        console.log(`✗ ${result.method} ${result.matchedPath} (${result.status}) — mock "${result.alias}"`);
        for (const err of result.validation.errors) {
          console.log(`  - ${err.path}: ${err.message}`);
        }
        console.log('');
        if (result.mode === 'error') {
          hasContractErrors = true;
        }
      }

      for (const warning of result.validation.warnings) {
        warningCount++;
        console.log(`⚠ ${result.method} ${result.matchedPath} (${result.status}) — mock "${result.alias}"`);
        console.log(`  ${warning.message}`);
        console.log('');
      }
    }
  }

  for (const skip of skipped) {
    console.log(`ℹ Mock "${skip.alias}" — ${skip.url}`);
    console.log(`  ${skip.reason === 'urlRegex mock' ? 'Regex URL pattern (skipped)' : 'Does not match any path in spec (skipped)'}`);
    console.log('');
  }

  const validatedCount = results.length;

  if (errorCount === 0 && warningCount === 0) {
    console.log('All mocks match their API contracts.');
  }

  console.log(`Mocks validated: ${validatedCount} | Errors: ${errorCount} | Warnings: ${warningCount} | Skipped: ${skipped.length}`);
  console.log('========================================\n');

  return hasContractErrors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/contractReport.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/contractReport.js tests/contractReport.test.js
git commit -m "feat: add contract report formatting with error/warning/skip output"
```

---

### Task 6: Wire Contract Validation into index.js

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/src/index.js`
- Modify: `/Users/kevinccbsg/brikev/twd-cli/tests/runTests.test.js`

- [ ] **Step 1: Write failing integration test**

Add to `/Users/kevinccbsg/brikev/twd-cli/tests/runTests.test.js` — first add the new mock at the top, then new tests.

Add after the existing `vi.mock('../src/config.js', ...)` line:

```javascript
vi.mock('../src/contracts.js', () => ({
  loadContracts: vi.fn(),
  validateMocks: vi.fn(),
}));
vi.mock('../src/contractReport.js', () => ({
  printContractReport: vi.fn(),
}));
```

Add the imports after the existing imports:

```javascript
import { loadContracts, validateMocks } from '../src/contracts.js';
import { printContractReport } from '../src/contractReport.js';
```

Update `createMockPage` to include `exposeFunction`:

```javascript
function createMockPage(evaluateResult) {
  return {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
    exposeFunction: vi.fn(),
  };
}
```

Add these new test cases inside the `describe("runTests", ...)` block:

```javascript
  it("should skip contract validation when no contracts configured", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    expect(loadContracts).not.toHaveBeenCalled();
  });

  it("should run contract validation when contracts configured", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      contracts: [{ source: './openapi.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests();

    expect(loadContracts).toHaveBeenCalled();
    expect(page.exposeFunction).toHaveBeenCalledWith('__twdCollectMock', expect.any(Function));
  });

  it("should return true when contract errors in error mode", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      contracts: [{ source: './openapi.json', mode: 'error' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(true);

    const result = await runTests();

    expect(result).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/runTests.test.js
```

Expected: FAIL — index.js doesn't import or call contract functions yet.

- [ ] **Step 3: Modify index.js to wire contracts**

Replace `/Users/kevinccbsg/brikev/twd-cli/src/index.js` with:

```javascript
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { reportResults } from 'twd-js/runner-ci';
import { loadConfig } from './config.js';
import { loadContracts, validateMocks } from './contracts.js';
import { printContractReport } from './contractReport.js';

export async function runTests() {
  let browser;
  try {
    const config = loadConfig();
    const workingDir = process.cwd();

    console.log('Starting TWD test runner...');
    console.log('Configuration:', JSON.stringify(config, null, 2));

    // Load contract validators if configured
    let contractValidators = [];
    if (config.contracts && config.contracts.length > 0) {
      contractValidators = await loadContracts(config.contracts, workingDir);
    }

    browser = await puppeteer.launch({
      headless: config.headless,
      args: config.puppeteerArgs,
    });

    const page = await browser.newPage();
    console.time('Total Test Time');

    // Register mock collector for contract validation
    const collectedMocks = new Map();
    if (config.contracts && config.contracts.length > 0) {
      await page.exposeFunction('__twdCollectMock', (mock) => {
        const key = `${mock.method}:${mock.url}:${mock.status}`;
        if (!collectedMocks.has(key)) {
          collectedMocks.set(key, mock);
        }
      });
    }

    // Navigate to your development server
    console.log(`Navigating to ${config.url} ...`);
    await page.goto(config.url);

    // Wait for the selector to be available
    await page.waitForSelector('#twd-sidebar-root', { timeout: config.timeout });
    console.log('Page loaded. Starting tests...');

    // Execute all tests
    const { handlers, testStatus } = await page.evaluate(async (retryCount) => {
      const TestRunner = window.__testRunner;
      const testStatus = [];
      const runner = new TestRunner({
        onStart: () => {},
        onPass: (test, retryAttempt) => {
          const entry = { id: test.id, status: "pass" };
          if (retryAttempt !== undefined) entry.retryAttempt = retryAttempt;
          testStatus.push(entry);
        },
        onFail: (test, err) => {
          testStatus.push({ id: test.id, status: "fail", error: `${err.message} (at ${window.location.href})` });
        },
        onSkip: (test) => {
          testStatus.push({ id: test.id, status: "skip" });
        },
      }, { retryCount });
      const handlers = await runner.runAll();
      return { handlers: Array.from(handlers.values()), testStatus };
    }, config.retryCount);

    console.log(`Tests to report: ${testStatus.length}`);

    // Display results in console
    reportResults(handlers, testStatus);

    // Display retry summary if any tests were retried
    const retriedTests = testStatus.filter(t => t.retryAttempt >= 2);
    if (retriedTests.length > 0) {
      console.log('\n⟳ Retried tests:');
      for (const t of retriedTests) {
        const handler = handlers.find(h => h.id === t.id);
        const name = handler ? handler.name : t.id;
        console.log(`  ✓ ${name} (passed on attempt ${t.retryAttempt})`);
      }
      console.log(`  ${retriedTests.length} test(s) required retries to pass.`);
    }

    // Exit with appropriate code
    let hasFailures = testStatus.some(test => test.status === 'fail');
    console.timeEnd('Total Test Time');

    // Contract validation
    if (contractValidators.length > 0) {
      if (collectedMocks.size === 0) {
        console.log('\nNo mocks collected — ensure twd-js supports contract collection');
      } else {
        const validationOutput = validateMocks(collectedMocks, contractValidators);
        const hasContractErrors = printContractReport(validationOutput);
        if (hasContractErrors) {
          hasFailures = true;
        }
      }
    }

    // Handle code coverage if enabled
    if (config.coverage && !hasFailures) {
      const coverage = await page.evaluate(() => window.__coverage__);
      if (coverage) {
        console.log('Collecting code coverage data...');
        const coverageDir = path.resolve(workingDir, config.coverageDir);
        const nycDir = path.resolve(workingDir, config.nycOutputDir);

        if (!fs.existsSync(nycDir)) {
          fs.mkdirSync(nycDir, { recursive: true });
        }
        if (!fs.existsSync(coverageDir)) {
          fs.mkdirSync(coverageDir, { recursive: true });
        }

        const coveragePath = path.join(nycDir, 'out.json');
        fs.writeFileSync(coveragePath, JSON.stringify(coverage));
        console.log(`Code coverage data written to ${coveragePath}`);
      } else {
        console.log('No code coverage data found.');
      }
    }

    await browser.close();
    console.log('Browser closed.');

    return hasFailures;

  } catch (error) {
    console.error('Error running tests:', error);
    if (browser) await browser.close();
    throw error;
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run
```

Expected: all tests PASS across all files.

- [ ] **Step 5: Commit**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/index.js tests/runTests.test.js
git commit -m "feat: wire contract validation into test runner lifecycle"
```

---

### Task 7: Full Integration Verification

**Files:**
- No new files — verification of everything working together.

- [ ] **Step 1: Run complete test suite**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run
```

Expected: all tests pass across all files.

- [ ] **Step 2: Run with coverage**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run --coverage
```

Expected: coverage report shows new files with good coverage.

- [ ] **Step 3: Verify no regressions in existing behavior**

The existing tests in `runTests.test.js` (retryCount, retry summary, failures) and `config.test.js` must all still pass. If any existing test broke, fix before proceeding.

- [ ] **Step 4: Commit any fixes**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add -A
git diff --cached --quiet || git commit -m "chore: final integration fixes"
```
