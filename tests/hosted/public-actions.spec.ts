import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = ["/", "/why-apply-pack", "/how-it-works", "/job-search-help", "/experience-connections",
  "/before-and-after", "/resume-screening", "/not-just-ai", "/pricing", "/why-customize",
  "/faq", "/about", "/get-started", "/contact", "/accessibility", "/privacy", "/terms", "/sign-in"];

test("hosted public routes, actions and responsive accessibility", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  const inventory: unknown[] = [];
  const scriptErrors: string[] = [];
  page.on("pageerror", error => scriptErrors.push(error.message));
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("main h1"), route).toHaveCount(1);
    const controls = await page.locator("a,button,input,select,textarea,summary").evaluateAll(elements => elements.map(el => ({
      tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().slice(0, 180),
      name: el.getAttribute("aria-label") || el.getAttribute("name"), href: el.getAttribute("href"),
      type: el.getAttribute("type"), disabled: el.hasAttribute("disabled"),
    })));
    inventory.push({ route, controls });
    for (const href of await page.locator('a[href^="#"]').evaluateAll(els => els.map(el => el.getAttribute("href")!).filter(value => value.length > 1))) {
      expect(await page.locator(href).count(), route + " broken fragment " + href).toBeGreaterThan(0);
    }
    const details = page.locator("details");
    for (let index = 0; index < await details.count(); index++) {
      const detail = details.nth(index);
      const summary = detail.locator("summary");
      if (await summary.isVisible()) {
        const before = await detail.getAttribute("open");
        await summary.click();
        expect(await detail.getAttribute("open")).not.toBe(before);
        await summary.click();
      }
    }
    const axe = await new AxeBuilder({ page }).exclude("script").analyze();
    expect(axe.violations.filter(v => ["serious", "critical"].includes(v.impact || "")), route).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, route + " horizontal overflow").toBe(false);
  }
  await testInfo.attach("route-action-inventory.json", { body: JSON.stringify(inventory, null, 2), contentType: "application/json" });
  expect(scriptErrors).toEqual([]);
});

test("hosted intake validation focuses usable errors without starting payment", async ({ page }) => {
  const payments: string[] = [];
  page.on("request", req => { if (req.url().includes("/api/checkout/")) payments.push(req.url()); });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/get-started");
  await page.getByRole("button", { name: /save and continue/i }).click();
  await expect(page.locator(".intake-errors")).toBeFocused();
  await page.getByRole("link", { name: "Enter your full name." }).click();
  await expect(page.getByLabel("Full name required")).toBeFocused();
  expect(payments).toEqual([]);
});
