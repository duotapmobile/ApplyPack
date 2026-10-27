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
  await expect(page.getByRole("region", { name: "Employer application questions", exact: true }).getByText("Describe how you prioritize competing requests.", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Employer-question context for Resume experience", exact: true }).getByText("Describe how you prioritize competing requests.", { exact: true })).toBeVisible();
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

const editedWording = "Organized community event schedules and priorities.";
const editConfirmation = "I want to save these edits as a new version and repeat wording, rendered-file and approval checks before a separate Send action.";
function editReceipt(body: Record<string, unknown>, reconciled = false) {
  return { action: "SAVE_OWNER_EDIT", result: { jobId: "78000000-0000-4000-8000-000000000001", requestId: body.requestId,
    versionId: "78000000-0000-4000-8000-000000000090", packetSha256: "a".repeat(64), sourceSha256: "f".repeat(64),
    state: "OWNER_REVIEW_REQUIRED", deliveryAuthorized: false, reconciled } };
}
async function beginEdit(page: Page) {
  const edit = page.getByRole("button", { name: "Edit wording", exact: true });
  await tabTo(page, edit); await page.keyboard.press("Enter");
  const wording = page.getByRole("textbox", { name: "Experience 1 bullet 1 wording", exact: true });
  await tabTo(page, wording); await wording.fill(editedWording);
  await keyboardCheck(page, page.getByLabel(editConfirmation, { exact: true }));
}
test("owner wording edits reset review choices and save an unapproved new version", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/admin/material-draft-jobs/*", async (route) => {
    const body = route.request().postDataJSON(); requests.push(body); await route.fulfill({ json: editReceipt(body) });
  });
  await open(page, "approve");
  const checks = page.getByRole("group", { name: "Seven required pair checks" }).getByRole("checkbox");
  await keyboardCheck(page, checks);
  await page.getByRole("button", { name: "Edit wording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve pair — do not send" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel edits" }).click();
  for (const box of await checks.all()) await expect(box).not.toBeChecked();
  await beginEdit(page);
  await expect(page.getByRole("textbox", { name: "Experience 1 bullet 1 wording", exact: true })).toHaveValue(editedWording);
  await expect(page.getByRole("textbox", { name: /organization|phone|name|date/i })).toHaveCount(0);
  const save = page.getByRole("button", { name: "Save new review version" }); await tabTo(page, save); await page.keyboard.press("Enter");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].action).toBe("SAVE_OWNER_EDIT");
  expect(Object.keys(requests[0]).sort()).toEqual(["action", "expectedSourceSha256", "expectedVersionId", "output", "requestId"]);
  expect(requests[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(requests[0].output).toMatchObject({ resume: { sections: [{ anchorFactId: "78000000-0000-4000-8000-000000000030", bullets: [{ text: editedWording, sourceAtomIds: ["4".repeat(64)] }] }] } });
  await expect(page.getByText(/New version saved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve pair — do not send" })).toBeDisabled();
  expect(requests.every((request) => request.action === "SAVE_OWNER_EDIT")).toBe(true);
});
test("owner explicitly reconciles the identical edit after a lost response without storing prose", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/admin/material-draft-jobs/*", async (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (requests.length === 1) return route.abort("failed");
    await route.fulfill({ json: editReceipt(body, true) });
  });
  await open(page, "send"); await beginEdit(page);
  await page.getByRole("button", { name: "Save new review version" }).click();
  const reconcile = page.getByRole("button", { name: "Reconcile saved edit" }); await expect(reconcile).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Experience 1 bullet 1 wording", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send approved pair" })).toBeDisabled();
  await tabTo(page, reconcile); await page.keyboard.press("Enter");
  await expect.poll(() => requests.length).toBe(2); expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByText(/New version saved/)).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify({ session: Object.entries(sessionStorage), local: Object.entries(localStorage) }));
  expect(storage).not.toContain(editedWording); expect(storage).not.toContain("Organized event schedules");
});
test("definitely rejected edits remain editable and require renewed confirmation", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/admin/material-draft-jobs/*", async (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (requests.length === 1) return route.fulfill({ status: 422, json: { editRejected: true, error: "The edited wording could not be validated against the confirmed sources. Review the wording and source selections." } });
    await route.fulfill({ json: editReceipt(body) });
  });
  await open(page, "wording"); await beginEdit(page); await page.getByRole("button", { name: "Save new review version" }).click();
  const wording = page.getByRole("textbox", { name: "Experience 1 bullet 1 wording", exact: true }); await expect(wording).toBeEnabled();
  await expect(wording).toHaveValue(editedWording); await expect(page.getByLabel(editConfirmation, { exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Save new review version" })).toBeDisabled();
  await wording.fill("Organized schedules for community events."); await keyboardCheck(page, page.getByLabel(editConfirmation, { exact: true }));
  await page.getByRole("button", { name: "Save new review version" }).click(); await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].requestId).not.toBe(requests[0].requestId); await expect(page.getByText(/New version saved/)).toBeVisible();
});
test("owner wording editor is labelled and reflows with expanded source choices", async ({ page }) => {
  await open(page, "wording"); await page.getByRole("button", { name: "Edit wording", exact: true }).click();
  await page.getByText("Confirmed sources for experience 1 bullet 1", { exact: true }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const results = await new AxeBuilder({ page }).exclude("script").analyze();
  expect(results.violations.filter((item) => ["moderate", "serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("owner-editor-320.png"), fullPage: true });
});

const changeInstructions = "Make the scheduling example more concise without adding new facts.";
async function beginSystemChange(page: Page) {
  await tabTo(page, page.getByRole("button", { name: "Request changes", exact: true })); await page.keyboard.press("Enter");
  const notes = page.getByRole("textbox", { name: "Requested wording changes", exact: true }); await tabTo(page, notes); await notes.fill(changeInstructions);
  await keyboardCheck(page, page.getByRole("group", { name: "Instructions for the new draft" }).getByRole("checkbox"));
}
function changeReceipt(body: Record<string, unknown>) {
  return { action: "REQUEST_DRAFT_CHANGES", result: { jobId: "78000000-0000-4000-8000-000000000001", requestId: body.requestId,
    parentVersionId: body.expectedVersionId, versionId: "78000000-0000-4000-8000-000000000090", requestSha256: "f".repeat(64),
    recorded: true, current: true, state: "CHANGES_REQUESTED", deliveryAuthorized: false } };
}
test("owner system revision requests require explicit keyboard confirmation and block the old Send", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/admin/material-draft-jobs/*", async (route) => { const body = route.request().postDataJSON(); requests.push(body); await route.fulfill({ json: changeReceipt(body) }); });
  await open(page, "changes"); await beginSystemChange(page);
  await expect(page.getByRole("button", { name: "Send approved pair" })).toBeDisabled();
  const notes = page.getByRole("textbox", { name: "Requested wording changes", exact: true }); await notes.fill(changeInstructions + " Keep the confirmed dates.");
  const confirmation = page.getByRole("group", { name: "Instructions for the new draft" }).getByRole("checkbox"); await expect(confirmation).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Queue new draft" })).toBeDisabled(); await keyboardCheck(page, confirmation);
  await tabTo(page, page.getByRole("button", { name: "Queue new draft" })); await page.keyboard.press("Enter"); await expect.poll(() => requests.length).toBe(1);
  expect(Object.keys(requests[0]).sort()).toEqual(["action", "expectedSourceSha256", "expectedVersionId", "instructions", "requestId"]);
  await expect(page.getByText(/Request recorded. A new unapproved draft is queued/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send approved pair" })).toBeDisabled();
});
test("owner system revision reconciles the same uncertain request without storing private instructions", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/admin/material-draft-jobs/*", async (route) => { const body = route.request().postDataJSON(); requests.push(body); if (requests.length === 1) return route.abort("failed"); await route.fulfill({ json: changeReceipt(body) }); });
  await open(page, "changes"); await beginSystemChange(page); await page.getByRole("button", { name: "Queue new draft" }).click();
  const reconcile = page.getByRole("button", { name: "Reconcile change request" }); await expect(reconcile).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Requested wording changes", exact: true })).toBeDisabled();
  await tabTo(page, reconcile); await page.keyboard.press("Enter"); await expect.poll(() => requests.length).toBe(2); expect(requests[1]).toEqual(requests[0]);
  const stored = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
  expect(stored).not.toContain(changeInstructions); expect(requests.every((value) => value.action === "REQUEST_DRAFT_CHANGES")).toBe(true);
});
test("owner system revision instructions are labelled and reflow at 320 CSS pixels", async ({ page }) => {
  await open(page, "changes"); await page.getByRole("button", { name: "Request changes", exact: true }).click(); await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.getByRole("textbox", { name: "Requested wording changes", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const results = await new AxeBuilder({ page }).exclude("script").analyze(); expect(results.violations.filter((item) => ["moderate", "serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("owner-request-changes-320.png"), fullPage: true });
});
