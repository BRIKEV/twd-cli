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
