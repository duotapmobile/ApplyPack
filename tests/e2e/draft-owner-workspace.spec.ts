import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoStable, waitForHydration } from "./helpers/hydration";

async function open(page: Page, state: string) { await gotoStable(page, `/e2e/document-drafts?state=${state}&at=${Date.now()}`); await waitForHydration(page); }
async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 100; index++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}
async function keyboardCheck(page: Page, boxes: Locator) {
  for (let index = 0; index < await boxes.count(); index++) { const box = boxes.nth(index); await expect(box).toBeEnabled(); await tabTo(page, box); await page.keyboard.press("Space"); await expect(box).toBeChecked(); }
}
test("owner reviews exact wording with keyboard and does not automatically approve or send", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/admin/material-draft-jobs/*", async (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    await route.fulfill({ json: { action: "REVIEW_WORDING", result: { deliveryAuthorized: false, versionId: body.review.versionId, reviewSha256: "f".repeat(64) } } });
  });
  await open(page, "wording");
  await expect(page.getByText("Organized event schedules", { exact: true })).toBeVisible();
  await expect(page.getByText("Describe how you prioritize competing requests.", { exact: true })).toBeVisible();
  const button = page.getByRole("button", { name: "Record wording review" }); await expect(button).toBeDisabled();
  await keyboardCheck(page, page.getByRole("group", { name: "Individual wording decisions" }).getByRole("checkbox"));
  await tabTo(page, button); await page.keyboard.press("Enter"); await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].action).toBe("REVIEW_WORDING"); expect((requests[0].review as { claims: unknown[] }).claims).toHaveLength(2);
  await expect(page.getByRole("button", { name: "Send approved pair" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve pair — do not send" })).toHaveCount(0);
});
test("owner approval and Send remain separate keyboard decisions", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/admin/material-draft-jobs/*", async (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    await route.fulfill({ json: body.action === "APPROVE_PAIR" ? { action: body.action, approvalSha256: "f".repeat(64), sent: false } : { action: body.action, releaseId: body.releaseId } });
  });
  await open(page, "approve"); const approval = page.getByRole("button", { name: "Approve pair — do not send" }); await expect(approval).toBeDisabled();
  await keyboardCheck(page, page.getByRole("group", { name: "Seven required pair checks" }).getByRole("checkbox"));
  await tabTo(page, page.getByLabel("Review note")); await page.keyboard.type("Reviewed both synthetic files against the confirmed sources.");
  await tabTo(page, approval); await page.keyboard.press("Enter"); await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].action).toBe("APPROVE_PAIR"); expect(Object.values(requests[0].checklist as object)).toEqual(Array(7).fill(true));
  await expect(page.getByRole("button", { name: "Send approved pair" })).toHaveCount(0);
  await open(page, "send"); expect(requests).toHaveLength(1); const send = page.getByRole("button", { name: "Send approved pair" }); await expect(send).toBeDisabled();
  await keyboardCheck(page, page.getByRole("group", { name: "Separate delivery decision" }).getByRole("checkbox"));
  await tabTo(page, page.getByLabel("Delivery note")); await page.keyboard.type("Send this separately approved synthetic pair through private access.");
  await tabTo(page, send); await page.keyboard.press("Enter"); await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].action).toBe("SEND_PAIR"); expect(requests[1].releaseId).toMatch(/^[a-f0-9-]{36}$/); expect(requests[1].outboxId).not.toBe(requests[1].releaseId);
});
test("owner reconciles the same uncertain employer review after a browser reload", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/admin/material-draft-jobs/*", async (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (requests.length === 1) return route.abort("failed");
    await route.fulfill({ json: { action: "REVALIDATE_RULE", result: { recorded: true, deliveryAuthorized: false, replayed: true, current: false,
      receipt: { id: body.receiptId, job_id: "78000000-0000-4000-8000-000000000001", reviewed_version_id: body.expectedVersionId, basis: body.expectedBasis } } } });
  });
  await open(page, "recovery"); await expect(page.getByText("Describe how you prioritize competing requests.", { exact: true })).toBeVisible();
  await keyboardCheck(page, page.getByRole("group", { name: "1. Recheck unchanged employer instructions" }).getByRole("checkbox"));
  await tabTo(page, page.getByRole("button", { name: "Record unchanged instructions review" })); await page.keyboard.press("Enter");
  await expect(page.getByText(/The action could not be confirmed/)).toBeVisible(); await page.reload(); await waitForHydration(page);
  const reconcile = page.getByRole("button", { name: "Reconcile saved rule review" }); await expect(reconcile).toBeEnabled();
  await expect(page.getByRole("button", { name: "Record unchanged instructions review" })).toBeDisabled();
  await tabTo(page, reconcile); await page.keyboard.press("Enter"); await expect.poll(() => requests.length).toBe(2); expect(requests[1]).toEqual(requests[0]);
  const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith("applypack:draft-evidence:")));
  expect(JSON.stringify(stored)).not.toContain("Describe how"); expect(JSON.stringify(stored)).not.toContain("checked_at");
});
test("owner workspace has labelled controls and reflows at 320 CSS pixels", async ({ page }) => {
  await open(page, "recovery"); await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.getByRole("heading", { name: "Saved public application questions" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const results = await new AxeBuilder({ page }).exclude("script").analyze();
  expect(results.violations.filter((item) => ["moderate", "serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("owner-recovery-320.png"), fullPage: true });
});
