import { expect, test } from "@playwright/test";
import { gotoStable } from "./helpers/hydration";

test("manual launch removes the public board and fails closed for board checkout", async ({ page, request }) => {
  const board = await gotoStable(page, "/job-board");
  expect(board?.status()).toBe(404);
  const robotDirectives = await page.locator('meta[name="robots"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("content")));
  expect(robotDirectives.length).toBeGreaterThan(0);
  expect(robotDirectives.every((content) => content?.includes("noindex"))).toBe(true);

  const subscription = await request.post("/api/checkout/job-board", { data: {} });
  expect(subscription.status()).toBe(410);
  expect(await subscription.json()).toMatchObject({ error: expect.stringContaining("not offered") });

  const boardMaterial = await request.post("/api/checkout/board-materials/10000000-0000-4000-8000-000000000001", { data: {} });
  expect(boardMaterial.status()).toBe(410);
});

for (const path of ["/", "/pricing", "/why-customize", "/get-started"]) {
  test(`${path} reflows without page-level horizontal scrolling at 320 CSS pixels`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await gotoStable(page, path);
    await page.locator("main").waitFor({ state: "visible" });
    const dimensions = await page.evaluate(() => ({
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    expect(dimensions.documentClientWidth).toBe(320);
    expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  });
}

test("canonical metadata and sitemap reflect only active public routes", async ({ page, request }) => {
  await gotoStable(page, "/pricing");
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toBeTruthy();
  expect(new URL(canonical!).pathname).toBe("/pricing");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/pricing");
  expect(sitemap).toContain("2026-10-02");
  expect(sitemap).not.toContain("/job-board");
});
