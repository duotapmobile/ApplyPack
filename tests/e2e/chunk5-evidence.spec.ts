import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const widths = [360, 390, 430, 768, 1024, 1440] as const;
const output = resolve("evidence/chunk-5/screenshots");

async function installSyntheticApis(page: Page) {
  await page.route("**/api/capacity/apply_pack", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ availableUnits: 10 }),
  }));
  await page.route("**/api/customer/references", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      references: [{
        opaqueId: "reference-synthetic-1",
        reference: {
          name: "Reference ending 47",
          title: "Redacted title",
          organization: "Redacted organization",
          relationship: "Redacted professional relationship",
          email: "redacted@example.invalid",
          phone: "redacted",
          sharedWorkContext: "Redacted synthetic work context.",
          capabilitiesCanVerify: ["Redacted synthetic capability"],
          approvedContextLine: "Redacted synthetic context line.",
        },
        permissionStatus: "CONFIRMED",
        permissionLastConfirmedAt: "2026-09-07T15:00:00.000Z",
        allowedApplications: [{
          permissionId: "permission-synthetic-1",
          jobSnapshotId: "65000000-0000-4000-8000-000000000501",
          employer: "Synthetic Employer 1",
          exactPosition: "Operations Coordinator",
          attestedAt: "2026-09-07T15:00:00.000Z",
        }],
      }],
    }),
  }));
}

async function assertAxe(page: Page) {
  const results = await new AxeBuilder({ page }).exclude("script").analyze();
  expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, name), fullPage: true, animations: "disabled", scale: "css" });
  await assertAxe(page);
}

test.beforeEach(async ({ page }) => {
  mkdirSync(output, { recursive: true });
  await installSyntheticApis(page);
});

test("Chunk 5 exact-ten selection remains usable at every required width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One Chromium run captures the exact required viewport matrix.");
  test.setTimeout(600_000);
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 960 });
    await page.goto("/e2e/chunk5?state=selection");
    await expect(page.locator(".match-card")).toHaveCount(10);
    await expect(page.getByRole("heading", { name: "10 Researched Job Matches" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Operations Coordinator Synthetic Employer 1" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Select Tailored Resume \+ Cover Letter for Operations Coordinator/ })).toBeEnabled();
    await expect(page.getByText(/Compensation was not published\. Verify pay/)).toBeVisible();
    await capture(page, `${width}-exact-ten-selection.png`);
  }
});

test("Chunk 5 selection checkout, delivery, proposals, references, support, and staff states are accessible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The state matrix is captured once at mobile and desktop widths.");
  test.setTimeout(600_000);
  for (const width of [390, 1440] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.goto("/e2e/chunk5?state=pending");
    await expect(page.getByRole("heading", { name: "Your researched-job orders" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Researching" })).toBeVisible();
    await capture(page, String(width) + "-pending-search.png");

    await page.goto("/e2e/chunk5?state=payment");
    await expect(page.getByRole("heading", { name: "Confirming your payment" })).toBeVisible();
    await capture(page, String(width) + "-payment-confirmation.png");

    await page.goto("/e2e/chunk5?state=selection");
    await page.getByRole("checkbox", { name: /Select Tailored Resume \+ Cover Letter for Operations Coordinator/ }).check();
    await expect(page.getByRole("heading", { name: /1 document set.*\$8 total/ })).toBeVisible();
    await expect(page.getByText("Tax is included. No added tax or fee.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Keep my existing timeline" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Use Career Break" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Use Family Caregiving" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Use my wording" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Do not add a career-break entry" })).toBeVisible();
    await capture(page, `${width}-selection-review.png`);

    for (const state of ["generating", "delivered", "substitution", "correction", "refund", "expired-download"] as const) {
      await page.goto(`/e2e/chunk5?state=${state}`);
      await expect(page.getByRole("heading", { name: "Your tailored documents" })).toBeVisible();
      await capture(page, `${width}-materials-${state}.png`);
    }

    await page.goto("/e2e/chunk5?state=delivered");
    await page.getByRole("button", { name: "Request the included factual correction" }).click();
    await expect(page.getByLabel("What the document says")).toBeVisible();
    await capture(page, `${width}-postdelivery-private-support.png`);

    await page.goto("/e2e/chunk5?state=references");
    await page.getByRole("radio", { name: "Add references for a materials order" }).check();
    await expect(page.getByRole("heading", { name: "Add a protected reference" })).toBeVisible();
    await expect(page.getByText(/fresh permission for that exact job/i)).toBeVisible();
    await capture(page, `${width}-reference-permission.png`);

    await page.goto("/e2e/chunk5?state=staff");
    await expect(page.getByRole("heading", { name: "Evidence-bound materials queue" })).toBeVisible();
    await expect(page.getByText(/Reference PII is never shown here/)).toBeVisible();
    await capture(page, `${width}-staff-review-queue.png`);
  }
});

test("Chunk 5 supports keyboard focus, reduced motion, forced colors, and 200 percent zoom", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The accessibility-mode matrix runs once in Chromium.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/chunk5?state=selection");
  await assertAxe(page);
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.reload();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.locator(".match-card")).toHaveCount(10);
  await page.screenshot({ path: resolve(output, "390-forced-colors-reduced-motion-200-percent.png"), fullPage: true, animations: "disabled", scale: "css" });
});
