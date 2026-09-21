import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function findOverflow(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: element.tagName.toLowerCase() + (element.className ? "." + String(element.className).trim().replace(/\s+/g, ".") : ""),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      })
      .filter((item) => item.left < -1 || item.right > viewportWidth + 1)
      .slice(0, 12);
  });
}

test("why-customize renders its approved message, links, and initial HTML", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const response = await page.goto("/why-customize");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beat the bot. Reach the human.");
  await expect(page.getByText("Not with tricks. With a résumé built from research, customized for the job, and grounded in experience you actually have.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Build My Custom Application" }).first()).toHaveAttribute("href", "/my-applypack");
  await expect(page.getByRole("link", { name: "Find Jobs That Fit" }).first()).toHaveAttribute("href", "/job-board");
  await expect(page.getByRole("link", { name: "Customize My Résumé" }).first()).toHaveAttribute("href", "/my-applypack");
  await expect(page.getByText("Illustrative fictional example, not an ATS result.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Questions about résumé bots and customization" })).toBeVisible();
  await expect(page.locator("details").filter({ hasText: "How do I get past résumé bots?" })).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("why-customize is discoverable and its internal destinations resolve", async ({ page, request }) => {
  for (const destination of ["/job-board", "/my-applypack", "/how-it-works"]) {
    expect((await request.get(destination)).status(), destination).toBe(200);
  }

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain("/why-customize");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/why-customize");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Why customize?" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Why customize?" })).toHaveAttribute("href", "/why-customize");

  await page.goto("/before-and-after");
  await expect(page.locator(".brief-tailoring-link")).toHaveAttribute("href", "/why-customize");
});

test("comparison drag, buttons, keyboard, and page scrolling share one stable state", async ({ page }) => {
  await page.goto("/why-customize#comparison");
  const slider = page.getByRole("slider", { name: "Before and After ApplyPack résumé comparison" });
  const canvas = page.getByTestId("resume-comparison-canvas");
  await expect(slider).toHaveAttribute("aria-valuenow", "50");
  await expect(slider).toHaveAttribute("aria-valuetext", /Split view/);

  await canvas.scrollIntoViewIfNeeded();
  const initialBox = await canvas.boundingBox();
  expect(initialBox).not.toBeNull();
  if (!initialBox) return;
  await page.mouse.move(initialBox.x + initialBox.width / 2, initialBox.y + initialBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(initialBox.x + initialBox.width * 0.25, initialBox.y + initialBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuenow", /2[4-6]/);

  await page.getByRole("button", { name: "After", exact: true }).click();
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await expect(slider).toHaveAttribute("aria-valuetext", "After ApplyPack version shown");
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuenow", "100");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", "95");
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: "Split view", exact: true }).click();
  await expect(slider).toHaveAttribute("aria-valuenow", "50");

  const finalBox = await canvas.boundingBox();
  expect(Math.round(finalBox?.width || 0)).toBe(Math.round(initialBox.width));
  expect(Math.round(finalBox?.height || 0)).toBe(Math.round(initialBox.height));
  expect(await canvas.evaluate((element) => getComputedStyle(element).touchAction)).toBe("pan-y");

  await canvas.scrollIntoViewIfNeeded();
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(initialBox.x + initialBox.width / 2, Math.min(initialBox.y + 40, 700));
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScroll);
});

test("comparison supports touch dragging and cancels cleanly for vertical scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Touch behavior is exercised in the mobile Chromium project.");
  await page.goto("/why-customize#comparison");
  const canvas = page.getByTestId("resume-comparison-canvas");
  const slider = page.getByRole("slider");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const client = await page.context().newCDPSession(page);
  const centerY = Math.min(box.y + box.height / 2, 620);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: centerY }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * 0.25, y: centerY }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(slider).toHaveAttribute("aria-valuenow", /2[4-6]/);

  const beforeScroll = await page.evaluate(() => window.scrollY);
  const scrollStartY = Math.min(box.y + 180, 620);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * 0.75, y: scrollStartY }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * 0.75, y: scrollStartY - 130 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScroll);
});

for (const viewport of [
  { label: "320 portrait", width: 320, height: 760 },
  { label: "375 portrait", width: 375, height: 812 },
  { label: "390 portrait", width: 390, height: 844 },
  { label: "430 portrait", width: 430, height: 932 },
  { label: "phone landscape", width: 844, height: 390 },
  { label: "tablet portrait", width: 768, height: 1024 },
  { label: "tablet landscape", width: 1024, height: 768 },
  { label: "desktop", width: 1440, height: 1000 },
]) {
  test(`why-customize has readable reflow and no page overflow at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/why-customize");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await findOverflow(page), viewport.label).toEqual([]);
    const handle = page.getByRole("slider");
    const handleBox = await handle.boundingBox();
    expect(handleBox?.width).toBeGreaterThanOrEqual(44);
    expect(handleBox?.height).toBeGreaterThanOrEqual(44);
    const buttons = page.locator("button", { hasText: /^(Before|Split view|After)$/ });
    for (let index = 0; index < await buttons.count(); index += 1) {
      expect((await buttons.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("why-customize passes focused accessibility and reduced-motion checks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/why-customize");
  const results = await new AxeBuilder({ page }).exclude("script").analyze();
  expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
  const questionControl = page.locator("details summary span").first();
  expect(Number.parseFloat(await questionControl.evaluate((element) => getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);
});

test("why-customize remains readable at 200 percent text size", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/why-customize");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await findOverflow(page)).toEqual([]);
  await expect(page.getByText("Important gap: No software onboarding experience is stated.", { exact: false }).last()).toBeVisible();
});

test("why-customize keeps essential comparison and Q&A copy without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3100/why-customize");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beat the bot. Reach the human.");
  await expect(page.getByRole("heading", { name: "Read both résumé excerpts" })).toBeVisible();
  await expect(page.getByText("Important gap: No software onboarding experience is stated.", { exact: false }).last()).toBeVisible();
  await expect(page.getByText("How do I get past résumé bots?")).toBeVisible();
  await context.close();
});
