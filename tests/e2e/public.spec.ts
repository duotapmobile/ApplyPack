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

test("the anonymous four-step intake is accessible and starts no checkout", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/get-started");
  await expect(page.getByText("STEP 1 OF 4")).toBeVisible();
  await expect(page.getByText(/No account or payment in this intake/)).toBeVisible();
  await page.getByRole("button", { name: /save and continue/i }).click();
  await expect(page.getByRole("link", { name: "Enter your full name." })).toBeVisible();
  await expect(page.getByLabel("Full name required")).toBeFocused();
  await page.getByLabel("Full name required").fill("E2E Customer");
  await page.getByLabel("Email address required").fill("e2e@example.invalid");
  await page.getByLabel("Current resume required").setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF") });
  await page.getByRole("button", { name: /save and continue/i }).click();
  await expect(page.getByText("STEP 2 OF 4")).toBeVisible();
  await page.getByRole("checkbox", { name: /Coordinating projects/ }).first().check();
  await page.getByRole("button", { name: /save and continue/i }).click();
  await expect(page.getByText("STEP 3 OF 4")).toBeVisible();
  await page.getByRole("button", { name: /save and continue/i }).click();
  await expect(page.getByText("STEP 4 OF 4")).toBeVisible();
  await page.getByRole("checkbox", { name: "Remote" }).check();
  await page.getByLabel("U.S. state or District of Columbia required").selectOption("VA");
  await page.getByRole("checkbox", { name: "Full Time" }).check();
  await page.getByLabel(/I agree to/).check();
  await page.getByRole("button", { name: "Finish intake" }).click();
  await expect(page.getByText(/Feasibility review is pending. No payment was started/)).toBeVisible();
  expect(await findOverflow(page)).toEqual([]);
  const axe = await new AxeBuilder({ page }).exclude("script").analyze();
  expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
});

for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
  test(`four-step intake has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 780 : 900 });
    await page.goto("/get-started");
    await expect(page.getByText("STEP 1 OF 4")).toBeVisible();
    expect(await findOverflow(page), `${width}px`).toEqual([]);
  });
}

test("intake supports keyboard focus, reduced motion, and forced colors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto("/get-started");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const duration = await page.locator(".wizard-progress i").evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
});
test("intake remains usable at 200 percent browser zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/get-started");
  await expect(page.getByText("STEP 1 OF 4")).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.getByLabel("Full name required")).toBeVisible();
  expect(await findOverflow(page)).toEqual([]);
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
