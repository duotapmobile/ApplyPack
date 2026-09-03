import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "/", "/why-apply-pack", "/how-it-works", "/job-search-help", "/experience-connections",
  "/before-and-after", "/resume-screening", "/not-just-ai", "/pricing",
  "/faq", "/about", "/get-started", "/contact", "/accessibility",
  "/privacy", "/terms",
];

for (const route of routes) {
  test(route + " renders a unique page", async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page).toHaveTitle(/Apply ?Pack/);
  });
}

test("homepage has no serious automated accessibility violations", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const results = await new AxeBuilder({ page }).exclude("script").analyze();
  expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
});

test("sign-in starts with the six-digit email-code flow", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByLabel("Email address").fill("person@example.com");
  await expect(page.getByRole("button", { name: /send.*code/i })).toBeEnabled();
});

test("all seven intake steps reflow and expose no serious axe findings at 320px", async ({ page }) => {
  test.setTimeout(360_000);
  const draftId = "23000000-0000-0000-0000-000000000099";
  await page.route("**/api/intake/draft", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ draft: null }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ draft: { id: draftId } }) });
  });
  await page.route("**/api/intake/draft/document", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draftId,
        document: { name: "resume.pdf", size: 32, mimeType: "application/pdf", scanStatus: "clean" },
      }),
    });
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/get-started");

  async function assertStep(title: RegExp) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    expect(await findOverflow(page), String(title)).toEqual([]);
    const axe = await new AxeBuilder({ page }).exclude("script").analyze();
    expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
  }

  await assertStep(/First, where are you/);
  await page.getByRole("button", { name: /save and continue/i }).click();
  const error = page.getByText(/Add your name, email, city, state, and time zone/);
  await expect(error).toBeFocused();
  await page.getByLabel("Full name").fill("E2E Customer");
  await page.getByLabel("City").fill("Tampa");
  await page.getByLabel("State or region").fill("Florida");
  await page.getByLabel("Time zone").selectOption({ label: "Eastern Time" });
  await page.getByRole("button", { name: /save and continue/i }).click();

  await assertStep(/Share the documents/);
  await page.getByLabel("Current resume required").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  });
  await page.getByLabel("Resume formatting").selectOption("applypack");
  await page.getByRole("button", { name: /save and continue/i }).click();

  await assertStep(/understand your full background/);
  await page.getByRole("checkbox", { name: "Paid work" }).check();
  await page.getByLabel(/Experience, accomplishments/).fill("I coordinated customer operations, documented work, and resolved service issues accurately.");
  await page.getByRole("button", { name: /save and continue/i }).click();

  await assertStep(/fit your life/);
  await page.getByLabel("Remote work").selectOption("required");
  await page.getByLabel("Hybrid roles").selectOption("exclude");
  await page.getByLabel("On-site roles").selectOption("exclude");
  await page.getByLabel("Listings without salary").selectOption("include_mark_unknown");
  await page.getByRole("checkbox", { name: "Full-time" }).check();
  await page.getByLabel("Listings without benefit details").selectOption("include_mark_unknown");
  await page.getByRole("button", { name: /save and continue/i }).click();

  await assertStep(/never show up again/);
  await page.getByRole("group", { name: "Never include required" }).getByRole("checkbox", { name: "Sales", exact: true }).check();
  await page.getByRole("button", { name: /save and continue/i }).click();

  await assertStep(/How far should this search stretch/);
  await page.getByLabel("Search direction").selectOption("different");
  await page.getByLabel("How far from your background?").selectOption("bigger_change");
  await page.getByLabel("Work authorization").fill("Authorized to work in the U.S.");
  await page.getByLabel("Need sponsorship?").selectOption("no");
  await page.getByLabel("Travel preference").fill("No travel");
  await page.getByRole("button", { name: /save and continue/i }).click();

  await assertStep(/Review the boundary/);
});

test("security headers are present", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["content-security-policy"]).toContain("default-src 'self'");
});

test("320px layout has no horizontal page overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 760 });
  for (const route of routes) {
    await page.goto(route);
    const overflow = await findOverflow(page);
    expect(overflow, route + "\n" + JSON.stringify(overflow, null, 2)).toEqual([]);
  }
});

async function findOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { selector: element.tagName.toLowerCase() + (element.className ? "." + String(element.className).trim().replace(/\s+/g, ".") : ""), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      })
      .filter((item) => item.left < -1 || item.right > viewportWidth + 1)
      .slice(0, 12);
  });
}
