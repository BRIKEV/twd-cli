import { twd, userEvent, screenDom } from "twd-js";
import { describe, it, beforeEach } from "twd-js/runner";

describe("App Component", () => {
  beforeEach(async () => {
    await twd.visit("/");
  });

  it("should render the main heading", async () => {
    const heading = screenDom.getByRole("heading", { level: 1 });
    twd.should(heading, "be.visible");
    twd.should(heading, "have.text", "Vite + React");
  });

  it("should handle button clicks and increment counter", async () => {
    const user = userEvent.setup();
    const button = screenDom.getByRole("button", { name: /count is/i });

    twd.should(button, "have.text", "count is 0");

    await user.click(button);
    twd.should(button, "have.text", "count is 1");

    await user.click(button);
    twd.should(button, "have.text", "count is 2");
  });

  it("should display the logos", async () => {
    const viteLogo = screenDom.getByAltText("Vite logo");
    const reactLogo = screenDom.getByAltText("React logo");

    twd.should(viteLogo, "be.visible");
    twd.should(reactLogo, "be.visible");
  });
});

// --- Valid mocks ---

describe("Contract Validation - Users API (OpenAPI 3.0)", () => {
  it("should mock GET /api/users with nested address and oneOf role", async () => {
    twd.mockRequest("getUsers", {
      method: "GET",
      url: "/api/users",
      status: 200,
      response: [
        {
          id: 1, name: "Alice", email: "alice@example.com",
          address: { street: "123 Main St", city: "Springfield", country: "US" },
          role: { type: "admin", permissions: ["read", "write"] },
        },
        {
          id: 2, name: "Bob", email: "bob@example.com",
          address: { street: "456 Oak Ave", city: "Portland", country: "US" },
          role: { type: "viewer" },
        },
      ],
    });
  });

  it("should mock GET /api/users/:id", async () => {
    twd.mockRequest("getUser", {
      method: "GET",
      url: "/api/users/1",
      status: 200,
      response: {
        id: 1, name: "Alice", email: "alice@example.com",
        address: { street: "123 Main St", city: "Springfield", country: "US" },
      },
    });
  });
});

describe("Contract Validation - Posts API (OpenAPI 3.1)", () => {
  it("should mock GET /api/posts with nested author and oneOf metadata", async () => {
    twd.mockRequest("getPosts", {
      method: "GET",
      url: "/api/posts",
      status: 200,
      response: [
        {
          id: 1, title: "First Post", body: "Hello world",
          author: { id: 1, name: "Alice" },
          metadata: { type: "article", category: "tech" },
        },
        {
          id: 2, title: "Second Post", body: "Quick note",
          author: { id: 2, name: "Bob" },
          metadata: { type: "note", tags: ["draft", "personal"] },
        },
      ],
    });
  });

  it("should mock GET /api/posts/:id", async () => {
    twd.mockRequest("getPost", {
      method: "GET",
      url: "/api/posts/1",
      status: 200,
      response: {
        id: 1, title: "First Post", body: "Hello world",
        author: { id: 1, name: "Alice" },
      },
    });
  });
});

// --- Invalid mocks (contract mismatches) ---

describe("Contract Validation - Mismatches", () => {
  it("should fail: missing nested address field", async () => {
    twd.mockRequest("getUserNoAddress", {
      method: "GET",
      url: "/api/users/10",
      status: 200,
      response: { id: 10, name: "Ghost", email: "ghost@example.com" },
    });
  });

  it("should fail: nested address missing required city", async () => {
    twd.mockRequest("getUserBadAddress", {
      method: "GET",
      url: "/api/users/11",
      status: 200,
      response: {
        id: 11, name: "Broken", email: "broken@example.com",
        address: { street: "789 Elm St" },
      },
    });
  });

  it("should fail: oneOf role with invalid variant", async () => {
    twd.mockRequest("getUserBadRole", {
      method: "GET",
      url: "/api/users/12",
      status: 200,
      response: {
        id: 12, name: "BadRole", email: "bad@example.com",
        address: { street: "1 St", city: "X", country: "US" },
        role: { type: "editor" },
      },
    });
  });

  it("should fail: post missing nested author object", async () => {
    twd.mockRequest("getPostNoAuthor", {
      method: "GET",
      url: "/api/posts/50",
      status: 200,
      response: { id: 50, title: "Orphan", body: "No author here" },
    });
  });

  it("should fail: post oneOf metadata matches neither variant", async () => {
    twd.mockRequest("getPostBadMeta", {
      method: "GET",
      url: "/api/posts/51",
      status: 200,
      response: {
        id: 51, title: "Bad Meta", body: "Wrong metadata",
        author: { id: 1, name: "Alice" },
        metadata: { type: "video", duration: 120 },
      },
    });
  });

  it("should warn: undocumented 404 status", async () => {
    twd.mockRequest("getUserNotFound", {
      method: "GET",
      url: "/api/users/999",
      status: 404,
      response: { message: "Not found" },
    });
  });

  it("should skip: endpoint not in any spec", async () => {
    twd.mockRequest("getUnknown", {
      method: "GET",
      url: "/api/unknown",
      status: 200,
      response: { theme: "dark" },
    });
  });
});

// ── Products API (OpenAPI 3.0) — Valid mocks ────────────────────────

describe("Contract Validation - Products API (OpenAPI 3.0)", () => {
  it("should mock GET /api/products with all valid fields", async () => {
    twd.mockRequest("getProductsFull", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Premium Widget",
          sku: "ABCD-12345678",
          description: "The best widget ever",
          price: 49.99,
          compareAtPrice: 59.99,
          quantity: 100,
          weight: 2.50,
          rating: 4.5,
          inStock: true,
          currency: "GBP",
          category: "toys",
          tags: ["new", "featured"],
          createdAt: "2026-03-31T10:00:00Z",
          releaseDate: "2026-04-01",
          website: "https://widgets.example.com",
          contactEmail: "sales@widgets.example.com",
          origin: "widgets.example.com",
          serverIp: "10.0.0.1",
          serverIpV6: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
          metadata: { color: "blue", material: "steel" },
        },
      ],
    });
  });

  it("should mock GET /api/products with minimal required fields", async () => {
    twd.mockRequest("getProductsMinimal", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          name: "W",
          price: 0.01,
          currency: "USD",
          inStock: true,
          category: "electronics",
        },
      ],
    });
  });

  it("should mock POST /api/products with valid create payload", async () => {
    twd.mockRequest("createProduct", {
      method: "POST",
      url: "/api/products",
      status: 201,
      response: {
        id: "660e8400-e29b-41d4-a716-446655440000",
        name: "New Product",
        price: 19.99,
        currency: "EUR",
        inStock: false,
        category: "clothing",
      },
    });
  });

  it("should accept null for nullable description (3.0 nullable)", async () => {
    twd.mockRequest("getProductNullDesc", {
      method: "GET",
      url: "/api/products/550e8400-e29b-41d4-a716-446655440000",
      status: 200,
      response: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Widget",
        price: 9.99,
        currency: "USD",
        inStock: true,
        category: "electronics",
        description: null,
      },
    });
  });

  it("should accept null for nullable compareAtPrice (3.0 nullable number)", async () => {
    twd.mockRequest("getProductNullPrice", {
      method: "GET",
      url: "/api/products/550e8400-e29b-41d4-a716-446655440001",
      status: 200,
      response: {
        id: "550e8400-e29b-41d4-a716-446655440001",
        name: "Widget",
        price: 9.99,
        currency: "USD",
        inStock: true,
        category: "electronics",
        compareAtPrice: null,
      },
    });
  });

  it("should accept all valid currency enum values", async () => {
    twd.mockRequest("getProductsAllCurrencies", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440010", name: "A", price: 1, currency: "USD", inStock: true, category: "food" },
        { id: "550e8400-e29b-41d4-a716-446655440011", name: "B", price: 1, currency: "EUR", inStock: true, category: "food" },
        { id: "550e8400-e29b-41d4-a716-446655440012", name: "C", price: 1, currency: "GBP", inStock: true, category: "food" },
        { id: "550e8400-e29b-41d4-a716-446655440013", name: "D", price: 1, currency: "JPY", inStock: true, category: "food" },
      ],
    });
  });

  it("should accept boolean inStock values", async () => {
    twd.mockRequest("getProductsBool", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440020", name: "In Stock", price: 5, currency: "USD", inStock: true, category: "books" },
        { id: "550e8400-e29b-41d4-a716-446655440021", name: "Out of Stock", price: 5, currency: "USD", inStock: false, category: "books" },
      ],
    });
  });

  it("should accept unique tags within limit", async () => {
    twd.mockRequest("getProductTags", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        {
          id: "550e8400-e29b-41d4-a716-446655440030",
          name: "Tagged",
          price: 5,
          currency: "USD",
          inStock: true,
          category: "electronics",
          tags: ["sale", "new", "featured"],
        },
      ],
    });
  });

  it("should accept metadata with string additionalProperties", async () => {
    twd.mockRequest("getProductMeta", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        {
          id: "550e8400-e29b-41d4-a716-446655440040",
          name: "With Meta",
          price: 5,
          currency: "USD",
          inStock: true,
          category: "electronics",
          metadata: { color: "red", size: "large", weight: "1kg" },
        },
      ],
    });
  });

  it("should mock GET /api/settings with valid properties only", async () => {
    twd.mockRequest("getSettings", {
      method: "GET",
      url: "/api/settings",
      status: 200,
      response: {
        theme: "dark",
        notifications: true,
        language: "en-US",
      },
    });
  });

  it("should accept null for nullable Settings customCss (3.0 nullable)", async () => {
    twd.mockRequest("getSettingsNullCss", {
      method: "GET",
      url: "/api/settings",
      status: 200,
      response: {
        theme: "auto",
        notifications: false,
        language: "es",
        customCss: null,
      },
    });
  });
});

// ── Products API (OpenAPI 3.0) — Invalid mocks (error mode) ─────────

describe("Contract Validation - Products Mismatches (OpenAPI 3.0 — error mode)", () => {
  it("should fail: empty name violates minLength", async () => {
    twd.mockRequest("getProductEmptyName", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "", price: 1, currency: "USD", inStock: true, category: "food" },
      ],
    });
  });

  it("should fail: invalid SKU pattern", async () => {
    twd.mockRequest("getProductBadSku", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", sku: "invalid-sku" },
      ],
    });
  });

  it("should fail: invalid uuid format for id", async () => {
    twd.mockRequest("getProductBadUuid", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "not-a-uuid", name: "W", price: 1, currency: "USD", inStock: true, category: "food" },
      ],
    });
  });

  it("should fail: invalid date-time format", async () => {
    twd.mockRequest("getProductBadDateTime", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", createdAt: "31-03-2026" },
      ],
    });
  });

  it("should fail: invalid date format", async () => {
    twd.mockRequest("getProductBadDate", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", releaseDate: "March 31, 2026" },
      ],
    });
  });

  it("should fail: invalid email format", async () => {
    twd.mockRequest("getProductBadEmail", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", contactEmail: "not-an-email" },
      ],
    });
  });

  it("should fail: invalid uri format", async () => {
    twd.mockRequest("getProductBadUri", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", website: "not a uri" },
      ],
    });
  });

  it("should fail: invalid ipv4 format", async () => {
    twd.mockRequest("getProductBadIp", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", serverIp: "999.999.999.999" },
      ],
    });
  });

  it("should fail: invalid ipv6 format", async () => {
    twd.mockRequest("getProductBadIpV6", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", serverIpV6: "not-ipv6" },
      ],
    });
  });

  it("should fail: price of 0 violates exclusiveMinimum", async () => {
    twd.mockRequest("getProductZeroPrice", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 0, currency: "USD", inStock: true, category: "food" },
      ],
    });
  });

  it("should fail: negative quantity violates minimum", async () => {
    twd.mockRequest("getProductNegQty", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", quantity: -1 },
      ],
    });
  });

  it("should fail: quantity exceeds maximum", async () => {
    twd.mockRequest("getProductOverQty", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", quantity: 1000000 },
      ],
    });
  });

  it("should fail: weight not multipleOf 0.01", async () => {
    twd.mockRequest("getProductBadWeight", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", weight: 1.005 },
      ],
    });
  });

  it("should fail: rating above maximum (5)", async () => {
    twd.mockRequest("getProductBadRating", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", rating: 5.1 },
      ],
    });
  });

  it("should fail: invalid enum value for currency", async () => {
    twd.mockRequest("getProductBadCurrency", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "BTC", inStock: true, category: "food" },
      ],
    });
  });

  it("should fail: invalid enum value for category", async () => {
    twd.mockRequest("getProductBadCategory", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "furniture" },
      ],
    });
  });

  it("should fail: string value for boolean inStock", async () => {
    twd.mockRequest("getProductBadBool", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: "yes", category: "food" },
      ],
    });
  });

  it("should fail: duplicate tags violates uniqueItems", async () => {
    twd.mockRequest("getProductDupTags", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", tags: ["sale", "sale"] },
      ],
    });
  });

  it("should fail: tags exceeds maxItems (10)", async () => {
    twd.mockRequest("getProductTooManyTags", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food",
          tags: ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"],
        },
      ],
    });
  });

  it("should fail: non-string value in metadata additionalProperties", async () => {
    twd.mockRequest("getProductBadMeta", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", metadata: { count: 5 } },
      ],
    });
  });

  it("should fail: extra property on Settings (additionalProperties: false)", async () => {
    twd.mockRequest("getSettingsBadExtra", {
      method: "GET",
      url: "/api/settings",
      status: 200,
      response: { theme: "dark", notifications: true, language: "en", extraField: "oops" },
    });
  });

  it("should fail: invalid language pattern in Settings", async () => {
    twd.mockRequest("getSettingsBadLang", {
      method: "GET",
      url: "/api/settings",
      status: 200,
      response: { theme: "light", notifications: false, language: "ENGLISH" },
    });
  });

  it("should fail: wrong type for nullable description (number instead of string|null)", async () => {
    twd.mockRequest("getProductBadNullable", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: [
        { id: "550e8400-e29b-41d4-a716-446655440000", name: "W", price: 1, currency: "USD", inStock: true, category: "food", description: 123 },
      ],
    });
  });
});

// ── Events API (OpenAPI 3.1) — Valid mocks ──────────────────────────

describe("Contract Validation - Events API (OpenAPI 3.1)", () => {
  it("should mock GET /api/events with all valid fields", async () => {
    twd.mockRequest("getEventsFull", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        {
          id: 1,
          name: "Tech Conference",
          startDate: "2026-06-15T09:00:00Z",
          endDate: "2026-06-17T18:00:00Z",
          active: true,
          priority: 3,
          score: 85.5,
          status: "published",
          attendees: ["alice@example.com", "bob@example.com"],
          description: "Annual tech conference",
          capacity: 500,
        },
      ],
    });
  });

  it("should mock GET /api/events with minimal required fields", async () => {
    twd.mockRequest("getEventsMinimal", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        {
          id: 2,
          name: "Meetup",
          startDate: "2026-07-01T19:00:00Z",
          active: false,
          status: "draft",
        },
      ],
    });
  });

  it("should accept null for nullable endDate (3.1 type array)", async () => {
    twd.mockRequest("getEventNullEnd", {
      method: "GET",
      url: "/api/events/1",
      status: 200,
      response: {
        id: 1,
        name: "Open-ended",
        startDate: "2026-08-01T10:00:00Z",
        active: true,
        status: "published",
        endDate: null,
      },
    });
  });

  it("should accept null for nullable description (3.1 type array)", async () => {
    twd.mockRequest("getEventNullDesc", {
      method: "GET",
      url: "/api/events/2",
      status: 200,
      response: {
        id: 2,
        name: "Silent event",
        startDate: "2026-09-01T10:00:00Z",
        active: true,
        status: "draft",
        description: null,
      },
    });
  });

  it("should accept null for nullable capacity (3.1 nullable integer)", async () => {
    twd.mockRequest("getEventNullCap", {
      method: "GET",
      url: "/api/events/3",
      status: 200,
      response: {
        id: 3,
        name: "Unlimited",
        startDate: "2026-10-01T10:00:00Z",
        active: true,
        status: "published",
        capacity: null,
      },
    });
  });

  it("should accept all valid status enum values", async () => {
    twd.mockRequest("getEventsAllStatus", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 10, name: "Draft Event", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft" },
        { id: 11, name: "Published Event", startDate: "2026-06-02T10:00:00Z", active: true, status: "published" },
        { id: 12, name: "Archived Event", startDate: "2026-06-03T10:00:00Z", active: false, status: "archived" },
      ],
    });
  });
});

// ── Events API (OpenAPI 3.1) — Invalid mocks (error mode) ──────────

describe("Contract Validation - Events Mismatches (OpenAPI 3.1 — error mode)", () => {
  it("should fail: empty events array violates minItems (1)", async () => {
    twd.mockRequest("getEventsEmpty", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [],
    });
  });

  it("should fail: event name too short (minLength: 3)", async () => {
    twd.mockRequest("getEventShortName", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 1, name: "Hi", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft" },
      ],
    });
  });

  it("should fail: invalid date-time format for startDate", async () => {
    twd.mockRequest("getEventBadDate", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 1, name: "Bad Date", startDate: "June 15, 2026", active: true, status: "draft" },
      ],
    });
  });

  it("should fail: float value for integer id", async () => {
    twd.mockRequest("getEventFloatId", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 1.5, name: "Float ID", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft" },
      ],
    });
  });

  it("should fail: number value for boolean active", async () => {
    twd.mockRequest("getEventBadBool", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 1, name: "Bad Bool", startDate: "2026-06-01T10:00:00Z", active: 1, status: "draft" },
      ],
    });
  });

  it("should fail: invalid enum value for status", async () => {
    twd.mockRequest("getEventBadStatus", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 1, name: "Bad Status", startDate: "2026-06-01T10:00:00Z", active: true, status: "deleted" },
      ],
    });
  });

  it("should fail: score at exclusiveMaximum boundary (100)", async () => {
    twd.mockRequest("getEventScoreMax", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 1, name: "Max Score", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft", score: 100 },
      ],
    });
  });

  it("should fail: priority below minimum (1)", async () => {
    twd.mockRequest("getEventLowPriority", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 1, name: "Low Priority", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft", priority: 0 },
      ],
    });
  });

  it("should fail: priority above maximum (5)", async () => {
    twd.mockRequest("getEventHighPriority", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        { id: 1, name: "High Priority", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft", priority: 6 },
      ],
    });
  });

  it("should fail: duplicate attendees violates uniqueItems", async () => {
    twd.mockRequest("getEventDupAttendees", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        {
          id: 1, name: "Dup Attendees", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft",
          attendees: ["same@test.com", "same@test.com"],
        },
      ],
    });
  });

  it("should fail: empty attendees array violates minItems (1)", async () => {
    twd.mockRequest("getEventNoAttendees", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        {
          id: 1, name: "No Attendees", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft",
          attendees: [],
        },
      ],
    });
  });

  it("should fail: invalid email format in attendees", async () => {
    twd.mockRequest("getEventBadAttendee", {
      method: "GET",
      url: "/api/events",
      status: 200,
      response: [
        {
          id: 1, name: "Bad Attendee", startDate: "2026-06-01T10:00:00Z", active: true, status: "draft",
          attendees: ["not-an-email"],
        },
      ],
    });
  });

  it("should fail: wrong type for nullable description (number instead of string|null)", async () => {
    twd.mockRequest("getEventBadNullable", {
      method: "GET",
      url: "/api/events/99",
      status: 200,
      response: {
        id: 99,
        name: "Bad Nullable",
        startDate: "2026-06-01T10:00:00Z",
        active: true,
        status: "draft",
        description: 42,
      },
    });
  });
});

// ── Content-Type forwarding — binary mocks vs image/* spec ───────────

describe("Contract Validation - Content-Type forwarding (Products API)", () => {
  it("should match image/png mock against image/* spec entry", async () => {
    twd.mockRequest("getProductThumbnailPng", {
      method: "GET",
      url: "/api/products/550e8400-e29b-41d4-a716-446655440000/thumbnail",
      status: 200,
      response: "fake-png-bytes",
      responseHeaders: { "Content-Type": "image/png" },
    });
  });

  it("should match image/jpeg mock against image/* spec entry", async () => {
    twd.mockRequest("getProductThumbnailJpeg", {
      method: "GET",
      url: "/api/products/550e8400-e29b-41d4-a716-446655440001/thumbnail",
      status: 200,
      response: "fake-jpeg-bytes",
      responseHeaders: { "content-type": "image/jpeg" },
    });
  });

  it("should warn when non-binary Content-Type has no matching spec entry", async () => {
    twd.mockRequest("getProductsAsXml", {
      method: "GET",
      url: "/api/products",
      status: 200,
      response: "<products></products>",
      responseHeaders: { "Content-Type": "application/xml" },
    });
  });

  it("should warn when mock has no responseHeaders against image-only endpoint", async () => {
    twd.mockRequest("getProductThumbnailNoHeader", {
      method: "GET",
      url: "/api/products/550e8400-e29b-41d4-a716-446655440002/thumbnail",
      status: 200,
      response: "fake-bytes",
    });
  });
});
