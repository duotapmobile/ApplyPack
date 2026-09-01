import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "/", "/how-it-works", "/job-search-help", "/experience-connections",
  "/before-and-after", "/resume-screening", "/not-just-ai", "/pricing",
  "/faq", "/about", "/get-started", "/contact", "/accessibility",
  "/privacy", "/terms",
];

for (const route of routes) {
  test(route + " renders a unique page", async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page).toHaveTitle(/ApplyPack/);
  });
}

test("homepage has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).exclude("script").analyze();
  expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
});

test("intake starts with a persistent email label", async ({ page }) => {
  await page.goto("/get-started");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByLabel("Email address").fill("person@example.com");
  await expect(page.getByRole("button", { name: /continue/i })).toBeEnabled();
});

test("security headers are present", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["content-security-policy"]).toContain("default-src 'self'");
});

test("320px layout has no horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  for (const route of routes) {
    await page.goto(route);
    const overflow = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>("body *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { selector: element.tagName.toLowerCase() + (element.className ? "." + String(element.className).trim().replace(/\s+/g, ".") : ""), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
        })
        .filter((item) => item.left < -1 || item.right > viewportWidth + 1)
        .slice(0, 12);
    });
    expect(overflow, route + "\n" + JSON.stringify(overflow, null, 2)).toEqual([]);
  }
});
