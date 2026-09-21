import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("capture Chunk 2 four-step and adaptive/error evidence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One Chromium evidence set is sufficient.");
  test.setTimeout(240_000);
  const output = resolve("evidence/chunk-2/screenshots");
  mkdirSync(output, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/get-started");
    await expect(page.getByText("STEP 1 OF 4")).toBeVisible();
    await page.screenshot({ path: resolve(output, `${width}-step-1.png`), fullPage: true });
    if (width === 390) {
      await page.getByRole("button", { name: /save and continue/i }).click();
      await page.screenshot({ path: resolve(output, "390-error-summary.png"), fullPage: true });
    }
    await page.getByLabel("Full name required").fill("Synthetic Customer");
    await page.getByLabel("Email address required").fill("synthetic@example.invalid");
    await page.getByLabel("Current resume required").setInputFiles({ name: "synthetic-resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF") });
    await page.getByRole("button", { name: /save and continue/i }).click();
    await expect(page.getByText("STEP 2 OF 4")).toBeVisible();
    await page.screenshot({ path: resolve(output, `${width}-step-2.png`), fullPage: true });
    await page.getByRole("checkbox", { name: /Preparing reports/ }).first().check();
    await page.getByRole("button", { name: /save and continue/i }).click();
    await expect(page.getByText("STEP 3 OF 4")).toBeVisible();
    await expect(page.getByText("Excel and spreadsheet tasks")).toBeVisible();
    await page.screenshot({ path: resolve(output, `${width}-step-3-adaptive.png`), fullPage: true });
    await page.getByRole("button", { name: /save and continue/i }).click();
    await expect(page.getByText("STEP 4 OF 4")).toBeVisible();
    await page.screenshot({ path: resolve(output, `${width}-step-4.png`), fullPage: true });
    const axe = await new AxeBuilder({ page }).exclude("script").analyze();
    expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
  }
});
