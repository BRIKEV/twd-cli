# twd-cli Contract Validation — Design Spec

**Date:** 2026-03-29
**Status:** Approved

## Purpose

Validate TWD mock responses against OpenAPI specs at CI time. Zero changes to how devs write tests. The spec is the source of truth — not a snapshot, not a dev's approval.

When `contracts` is configured in `twd.config.json`, twd-cli validates every `mockRequest` response against the matching OpenAPI spec after tests complete. Mismatches are printed as warnings or errors depending on config.

## Scope

**In scope:**
- Config: `contracts` array in `twd.config.json`
- Mock collection via `page.exposeFunction('__twdCollectMock')`
- Validation of collected mocks against OpenAPI specs using `openapi-mock-validator`
- Formatted contract report output
- Exit code reflects contract errors when `mode: "error"`

**Out of scope:**
- Changes to twd-js (done separately — adds `if (typeof window.__twdCollectMock === 'function')` call in mockRequest)
- Spec fetching from URLs (source must be a local file, downloaded in CI)
- YAML spec support
- Dev-time validation (CI only)

**Note on twd-js dependency:** The `page.exposeFunction('__twdCollectMock')` will be registered by twd-cli regardless. Until twd-js is updated to call it, no mocks will be collected and the contract report will show "Mocks validated: 0". This is safe — the feature activates naturally when twd-js ships the one-line change.

## Dependencies

```json
{
  "openapi-mock-validator": "file:../openapi-mock-validator"
}
```

Swap to a published version when `openapi-mock-validator` is released to npm.

## Config

Optional `contracts` field in `twd.config.json`:

```jsonc
{
  "url": "http://localhost:5173",
  "retryCount": 2,
  "contracts": [
    {
      "source": "./openapi/checkout.json",
      "baseUrl": "/checkout",
      "mode": "warn",
      "strict": true
    }
  ]
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `source` | Yes | — | Path to OpenAPI JSON file (relative to project root) |
| `baseUrl` | No | `"/"` | Prefix to strip from mock URLs before matching spec paths |
| `mode` | No | `"warn"` | `"warn"` = print + exit 0, `"error"` = print + exit 1 on mismatches |
| `strict` | No | `true` | Reject additional properties not in spec |

If `contracts` is missing or empty, contract validation is skipped entirely. Zero breaking changes.

## Data Flow

```
1. loadConfig()
   └→ contracts array available (or undefined)

2. If contracts exist:
   └→ For each contract: read JSON file, create OpenAPIMockValidator, await init()
   └→ Store validators with their config (baseUrl, mode, strict)

3. page.exposeFunction('__twdCollectMock', callback)
   └→ Callback deduplicates by method+url+status and stores in a Map
   └→ Stores: { alias, url, method, status, response, urlRegex }

4. page.evaluate() — tests run as normal
   └→ Each mockRequest calls __twdCollectMock (when twd-js supports it)
   └→ Mocks accumulate in Node.js memory during test execution

5. reportResults(handlers, testStatus) — existing test output, unchanged

6. If contracts exist and mocks were collected:
   └→ For each collected mock:
      a. Skip if urlRegex === true (ℹ info message)
      b. For each contract: strip baseUrl from mock URL, attempt matchPath()
      c. First contract whose baseUrl matches wins
      d. If matched: validateResponse(path, method, status, response, { strict })
      e. If no contract matches: skip (ℹ info message)
   └→ Print contract report
   └→ If any contract with mode="error" has validation errors: hasFailures = true

7. Exit code: test failures OR contract errors (mode="error")
```

## Mock Collection

twd-cli registers `__twdCollectMock` via Puppeteer's `page.exposeFunction` before tests run:

```javascript
const collectedMocks = new Map();

await page.exposeFunction('__twdCollectMock', (mock) => {
  const key = `${mock.method}:${mock.url}:${mock.status}`;
  if (!collectedMocks.has(key)) {
    collectedMocks.set(key, mock);
  }
});
```

**Deduplication:** Same `method + url + status` combination registered across multiple tests is validated only once. The first registration wins (response payloads for the same endpoint should be structurally identical across tests).

**urlRegex mocks:** When `urlRegex: true`, the URL is a regex pattern and can't be matched against spec paths. These are skipped with an info message.

## URL Matching Strategy

For each collected mock, for each contract:

1. Check if mock URL starts with `contract.baseUrl`
2. If not → try next contract
3. If yes → strip baseUrl prefix: `"/checkout/v1/carts"` → `"/v1/carts"`
4. Call `validator.matchPath("/v1/carts", "POST")`
5. If match found → validate response against schema
6. If no match → mock doesn't exist in this spec (skip to next contract)

First contract match wins. If no contract matches, the mock is skipped with an info message (expected for third-party API mocks like Adyen).

**baseUrl `"/"` (default):** No stripping happens. Mock URL is passed directly to matchPath. This works when the spec paths match the full mock URLs.

## File Structure

```
src/
├── index.js          # Modified: wire exposeFunction + call contract validation
├── config.js         # No changes
├── contracts.js      # NEW: load specs, validate collected mocks
└── contractReport.js # NEW: format and print report
```

### contracts.js

Two exported functions:

**`loadContracts(contracts, workingDir)`**
- For each contract config: resolve source path, read JSON, create `OpenAPIMockValidator`, `await init()`
- Returns array of `{ validator, baseUrl, mode, strict }` objects
- If a source file doesn't exist or is invalid JSON: warn and skip that contract (don't crash)

**`validateMocks(collectedMocks, contracts)`**
- Iterates collected mocks
- For each mock: find matching contract, strip baseUrl, matchPath, validateResponse
- Returns structured results:
```javascript
{
  results: [
    {
      alias: "createPayment",
      url: "/checkout/v1/payments/",
      method: "POST",
      status: 201,
      specSource: "./openapi/checkout.json",
      validation: { valid: false, errors: [...], warnings: [...] },
    }
  ],
  skipped: [
    { alias: "adyenSetup", url: "/checkoutshopper/v1/sessions/.../setup", reason: "no matching contract" },
    { alias: "updateOrder", url: "regex pattern", reason: "urlRegex mock" },
  ]
}
```

### contractReport.js

One exported function:

**`printContractReport(validationOutput, contracts)`**
- Prints the formatted report with ✗ errors, ⚠ warnings, ℹ skipped
- Returns `hasContractErrors` boolean (true if any `mode: "error"` contract has validation errors)

Report format:
```
========================================
TWD Contract Validation
========================================
Source: ./openapi/checkout.json
Mode: warn

✗ POST /v1/payments/ (201) — mock "createPayment"
  - /payment_client_key: must NOT have additional properties
  - /features: must have required property 'features'

⚠ GET /v1/orders/{id}/status (404) — mock "getOrderStatus"
  Status 404 not documented for GET /v1/orders/{id}/status

ℹ Mock "adyenSetup" — /checkoutshopper/v1/sessions/xxx/setup
  Does not match any path in spec (skipped)

Mocks validated: 12 | Errors: 3 | Warnings: 1 | Skipped: 4
========================================
```

### index.js modifications

Changes to `runTests()`:

1. After `loadConfig()`: if `config.contracts` exists, call `loadContracts()`
2. Before `page.evaluate()`: register `page.exposeFunction('__twdCollectMock', ...)`
3. After `reportResults()`: call `validateMocks()` then `printContractReport()`
4. After coverage collection: factor `hasContractErrors` into the return value

The existing test execution flow is unchanged. Contract validation is an additive step that runs after tests complete.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `contracts` not in config | Skip contract validation entirely |
| Source file doesn't exist | Warn: "Could not read {source}, skipping contract" |
| Source file is invalid JSON | Warn: "Could not parse {source}, skipping contract" |
| OpenAPI spec is invalid | Warn: "Could not initialize validator for {source}, skipping contract" |
| No mocks collected (twd-js not updated yet) | Print: "No mocks collected — ensure twd-js supports contract collection" |
| Mock uses urlRegex | ℹ info: skip with reason |
| Mock URL doesn't match any contract baseUrl | ℹ info: skip with reason |
| Matched path but status not in spec | ⚠ warning in report |
| Schema validation fails | ✗ error in report |

Nothing crashes the test run. Contract validation degrades gracefully in every case.

## Testing Strategy

Tests use vitest (matching existing twd-cli test setup).

### contracts.test.js
- Load valid spec file → validators created
- Load missing file → warns and skips
- Load invalid JSON → warns and skips
- Validate mock matching correct spec → returns validation result
- Validate mock with baseUrl stripping → correct path matching
- Validate mock with no matching contract → skipped
- Validate urlRegex mock → skipped
- Deduplication → same mock registered twice, validated once

### contractReport.test.js
- Format report with errors → shows ✗ lines
- Format report with warnings → shows ⚠ lines
- Format report with skipped → shows ℹ lines
- Clean run → "All mocks match" message
- mode="error" with errors → returns hasContractErrors=true
- mode="warn" with errors → returns hasContractErrors=false

### Integration in runTests.test.js
- Config with contracts → exposeFunction called, validation runs
- Config without contracts → no validation, same behavior as today

## Design Decisions

### Why CI only?
twd-relay (dev) must be fast. Loading specs and validating adds latency. Devs iterate quickly — contract warnings during development are noise. CI is where accountability lives.

### Why file paths, not URLs?
Keeps twd-cli simple — no HTTP client, no network timeouts, no retry logic. In CI, a prior step downloads the spec file. This is more reliable and cacheable.

### Why per-contract mode?
Teams might have strict enforcement on their own API spec but just warnings on a partner's spec they don't control.

### Why deduplication?
The same mock (e.g., "createCart") is registered in every test that needs it. Validating 15 identical payloads against the same schema wastes time and produces duplicate output. First registration wins.

### Why page.exposeFunction over events or window globals?
- Data flows directly to Node.js — zero browser memory growth
- Works naturally with clearMocks (data already collected before clear happens)
- Backward compatible — twd-js checks if function exists, silently skips if not
- No event wiring, no console parsing, no serialization overhead
