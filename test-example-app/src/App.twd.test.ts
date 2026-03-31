import { twd, userEvent, screenDom } from "twd-js";
import { describe, it } from "twd-js/runner";

describe("App Component", () => {
  it("should render the main heading", async () => {
    await twd.visit("/");

    // Use screenDom for testing library queries
    const heading = screenDom.getByRole("heading", { level: 1 });
    twd.should(heading, "be.visible");
    twd.should(heading, "have.text", "Vite + React");
  });

  it("should handle button clicks and increment counter", async () => {
    await twd.visit("/");

    const user = userEvent.setup();
    const button = screenDom.getByRole("button", { name: /count is/i });

    // Check initial state
    twd.should(button, "have.text", "count is 0");

    // Click the button
    await user.click(button);

    // Verify counter incremented
    twd.should(button, "have.text", "count is 1");

    // Click again
    await user.click(button);

    // Verify counter incremented again
    twd.should(button, "have.text", "count is 2");
  });

  it("should display the logos", async () => {
    await twd.visit("/");

    const viteLogo = screenDom.getByAltText("Vite logo");
    const reactLogo = screenDom.getByAltText("React logo");

    twd.should(viteLogo, "be.visible");
    twd.should(reactLogo, "be.visible");
  });
});

// --- Valid mocks ---

describe("Contract Validation - Users API (OpenAPI 3.0)", () => {
  it("should mock GET /api/users with nested address and oneOf role", async () => {
    await twd.visit("/");

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
    await twd.visit("/");

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
    await twd.visit("/");

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
    await twd.visit("/");

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
    await twd.visit("/");

    twd.mockRequest("getUserNoAddress", {
      method: "GET",
      url: "/api/users/10",
      status: 200,
      response: { id: 10, name: "Ghost", email: "ghost@example.com" },
    });
  });

  it("should fail: nested address missing required city", async () => {
    await twd.visit("/");

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
    await twd.visit("/");

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
    await twd.visit("/");

    twd.mockRequest("getPostNoAuthor", {
      method: "GET",
      url: "/api/posts/50",
      status: 200,
      response: { id: 50, title: "Orphan", body: "No author here" },
    });
  });

  it("should fail: post oneOf metadata matches neither variant", async () => {
    await twd.visit("/");

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
    await twd.visit("/");

    twd.mockRequest("getUserNotFound", {
      method: "GET",
      url: "/api/users/999",
      status: 404,
      response: { message: "Not found" },
    });
  });

  it("should skip: endpoint not in any spec", async () => {
    await twd.visit("/");

    twd.mockRequest("getSettings", {
      method: "GET",
      url: "/api/settings",
      status: 200,
      response: { theme: "dark" },
    });
  });
});
