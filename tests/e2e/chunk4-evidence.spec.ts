import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { gotoStable, waitForHydration } from "./helpers/hydration";

const resume = { name: "synthetic-resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF") };

async function completeFeasibility(page: Page, state: string) {
  await page.context().clearCookies();
  const invitation = state === "likely"
    ? "#invitationId=23000000-0000-4000-8000-000000000103&invitationSecret=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    : "";
  await gotoStable(page, `/get-started?feasibility=${encodeURIComponent(state)}${invitation}`);
  await page.getByLabel("Full name required").fill("Synthetic Evidence Customer");
  await page.getByLabel("Email address required").fill("chunk4-evidence@example.invalid");
  await page.getByLabel("Current resume required").setInputFiles(resume);
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.getByRole("checkbox", { name: /Coordinating projects/ }).first().check();
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.getByRole("checkbox", { name: "Remote" }).check();
  await page.getByLabel("U.S. state or District of Columbia required").selectOption("VA");
  await page.getByRole("checkbox", { name: "Full Time" }).check();
  await page.getByLabel(/I agree to/).check();
  await expect(page.getByText("Review your search")).toBeVisible();
  await page.getByRole("button", { name: "Finish intake" }).click();
  await expect(page.locator(".feasibility-result")).toBeVisible();
}

async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage: true, animations: "disabled", scale: "css" });
  await waitForHydration(page);
  const accessibility = await new AxeBuilder({ page }).exclude("script").analyze();
  expect(accessibility.violations.filter((item) => ["moderate", "serious", "critical"].includes(item.impact || ""))).toEqual([]);
}

async function clickHydratedCheckout(page: Page) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await waitForHydration(page);
      await page.getByRole("button", { name: "Use My $18.99 Checkout Invitation" }).click();
      await page.waitForURL(/\/e2e\/chunk4\?state=confirming$/, { timeout: 10_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await gotoStable(page, page.url());
    }
  }
  throw lastError;
}

test("Chunk 4 review, eligibility, payment, exception, adjustment, refund, and exact-ten evidence", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const mobile = testInfo.project.name === "mobile";
  const width = mobile ? 390 : 1440;
  await page.setViewportSize({ width, height: mobile ? 844 : 1000 });
  const output = resolve("evidence/chunk-4/screenshots");
  mkdirSync(output, { recursive: true });

  await completeFeasibility(page, "likely");
  await expect(page.getByRole("button", { name: "Use My $18.99 Checkout Invitation" })).toBeVisible();
  await expect(page.getByText(/exact 24-hour deadline starts only after verified payment/i)).toBeVisible();
  await capture(page, resolve(output, `${width}-review-and-likely-checkout.png`));
  await clickHydratedCheckout(page);
  await expect(page.getByRole("heading", { name: "Confirming your payment" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/browser return is not proof of payment/i)).toBeVisible();
  await capture(page, resolve(output, `${width}-payment-confirming.png`));

  await gotoStable(page, "/e2e/chunk4?state=started");
  await expect(page.getByRole("heading", { name: "Your search has started" })).toBeVisible();
  await expect(page.getByText(/Payment is verified and the search is active/i)).toBeVisible();
  await capture(page, resolve(output, `${width}-confirmed-search-portal.png`));

  for (const [state, heading, filename] of [
    ["capacity-exception", "Capacity changed after payment", "capacity-exception"],
    ["adjustment", "Your search status", "adjustment-required"],
    ["refund-processing", "Your search status", "refund-processing"],
    ["delivered", "Your 10 verified matches", "delivered-exact-ten"],
  ] as const) {
    await gotoStable(page, `/e2e/chunk4?state=${state}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (state === "delivered") {
      await expect(page.locator(".match-card")).toHaveCount(10);
      await expect(page.getByText("What this job actually involves").first()).toBeVisible();
      await expect(page.getByText("What to know").first()).toBeVisible();
    }
    await capture(page, resolve(output, `${width}-${filename}.png`));
  }

  const feasibilityStates = [
    ["limited", "We cannot confirm ten yet"],
    ["infeasible", "This search is not feasible as entered"],
    ["stale", "Your search needs a fresh check"],
    ["error", "We could not finish the check"],
  ] as const;
  for (const [state, title] of feasibilityStates) {
    await completeFeasibility(page, state);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use My $18.99 Checkout Invitation" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Leave without paying" })).toBeVisible();
    await capture(page, resolve(output, `${width}-feasibility-${state}.png`));
  }

  await completeFeasibility(page, "pending");
  await expect(page.getByRole("heading", { name: "Checking your search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use My $18.99 Checkout Invitation" })).toHaveCount(0);
});
