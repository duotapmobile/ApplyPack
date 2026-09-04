import { expect, test, type Locator, type Page } from "@playwright/test";

const resume = { name: "synthetic-resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF") };

async function tabTo(page: Page, locator: Locator, maximumTabs = 200) {
  const target = await locator.elementHandle();
  if (!target) throw new Error("Keyboard target was not rendered.");
  for (let index = 0; index < maximumTabs; index += 1) {
    if (await page.evaluate((element) => document.activeElement === element, target)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard focus did not reach ${await locator.getAttribute("id") || await locator.textContent()}.`);
}

async function reachReview(page: Page) {
  await page.goto("/get-started");
  await page.getByLabel("Full name required").fill("Review Customer");
  await page.getByLabel("Email address required").fill("review@example.invalid");
  await page.getByLabel("Current resume required").setInputFiles(resume);
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.getByRole("checkbox", { name: /Coordinating projects/ }).first().check();
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.getByRole("checkbox", { name: "Remote" }).check();
  await page.getByLabel("U.S. state or District of Columbia required").selectOption("VA");
  await page.getByRole("checkbox", { name: "Full Time" }).check();
}

test("error summary retains focus and every linked field owns its adjacent error", async ({ page }) => {
  await page.goto("/get-started");
  await page.getByRole("button", { name: /save and continue/i }).click();
  const summary = page.locator(".intake-errors");
  await expect(summary).toBeFocused();
  const nameError = page.locator("#full-name-error");
  await expect(nameError).toHaveText("Enter your full name.");
  await expect(page.getByLabel("Full name required")).toHaveAttribute("aria-describedby", /full-name-error/);
  await page.getByRole("link", { name: "Enter your full name." }).click();
  await expect(page.getByLabel("Full name required")).toBeFocused();
  await expect(page.getByLabel("Current resume required")).toHaveAttribute("aria-describedby", /resume-error/);
});

test("keyboard-only operation completes all four steps with visible focus", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/get-started");
  const fullName = page.getByLabel("Full name required");
  await tabTo(page, fullName);
  await page.keyboard.type("Keyboard Customer");
  const focusStyle = await fullName.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focusStyle).not.toBe("none");

  const email = page.getByLabel("Email address required");
  await tabTo(page, email);
  await page.keyboard.type("keyboard@example.invalid");
  const resumeInput = page.getByLabel("Current resume required");
  await tabTo(page, resumeInput);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooserPromise).setFiles(resume);
  await expect(page.locator(".file-drop b").filter({ hasText: /^synthetic-resume\.pdf — quarantined$/ })).toBeVisible();

  let next = page.getByRole("button", { name: /save and continue/i });
  await tabTo(page, next);
  await page.keyboard.press("Enter");
  await expect(page.getByText("STEP 2 OF 4")).toBeVisible();
  const activity = page.getByRole("checkbox", { name: /Coordinating projects/ }).first();
  await tabTo(page, activity);
  await page.keyboard.press("Space");
  next = page.getByRole("button", { name: /save and continue/i });
  await tabTo(page, next);
  await page.keyboard.press("Enter");
  await expect(page.getByText("STEP 3 OF 4")).toBeVisible();
  next = page.getByRole("button", { name: /save and continue/i });
  await tabTo(page, next);
  await page.keyboard.press("Enter");
  await expect(page.getByText("STEP 4 OF 4")).toBeVisible();

  const remote = page.getByRole("checkbox", { name: "Remote" });
  await tabTo(page, remote);
  await page.keyboard.press("Space");
  const state = page.getByLabel("U.S. state or District of Columbia required");
  await tabTo(page, state);
  await page.keyboard.type("Virginia");
  const fullTime = page.getByRole("checkbox", { name: "Full Time" });
  await tabTo(page, fullTime);
  await page.keyboard.press("Space");
  const agreement = page.getByLabel(/I agree to/);
  await tabTo(page, agreement);
  await page.keyboard.press("Space");
  const finish = page.getByRole("button", { name: "Finish intake" });
  await tabTo(page, finish);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Feasibility review is pending. No payment was started/)).toBeVisible();
});

test("review exposes every section and an earlier edit returns directly to review", async ({ page }) => {
  test.setTimeout(120_000);
  await reachReview(page);
  const expectedSections = [
    "Contact and documents", "Search direction", "Experience and skills", "Work modes and location",
    "Employment type and schedule", "Benefits", "Work conditions", "Compensation",
    "Exclusions and unknown details", "Terms and service boundary",
  ];
  for (const section of expectedSections) {
    await expect(page.getByRole("button", { name: `Edit ${section.toLowerCase()}` })).toBeVisible();
  }
  await page.getByRole("button", { name: "Edit contact and documents" }).click();
  await expect(page.getByText("STEP 1 OF 4")).toBeVisible();
  await expect(page.getByLabel("Full name required")).toBeFocused();
  await page.getByLabel("Full name required").fill("Edited Review Customer");
  await page.getByRole("button", { name: "Save and return to review" }).click();
  await expect(page.getByText("STEP 4 OF 4")).toBeVisible();
  await expect(page.getByText(/Edited Review Customer/)).toBeVisible();
  await expect(page.locator(".review-list").getByText(/synthetic-resume\.pdf/)).toBeVisible();
  await page.getByRole("button", { name: "Edit benefits" }).click();
  await expect(page.locator("#benefits-preferences")).toBeFocused();
});

test("choosing neither removes the prior cover letter and its processing eligibility", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/get-started");
  await page.getByLabel("Previous cover letter").setInputFiles({ ...resume, name: "prior-cover.pdf" });
  await expect(page.locator(".file-drop b").filter({ hasText: /^prior-cover\.pdf — quarantined$/ })).toBeVisible();
  await page.getByRole("radio", { name: "Do not use it and remove it" }).click();
  await expect(page.locator(".file-drop b").filter({ hasText: /prior-cover\.pdf/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "How may we use the previous cover letter?" })).toHaveCount(0);
});

test("Chromium browser-level 200 percent scale reflows without CSS zoom", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One Chromium browser-level zoom proof is sufficient.");
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 720,
    height: 450,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: 1440,
    screenHeight: 900,
  });
  await page.goto("/get-started");
  const metrics = await page.evaluate(() => ({
    cssWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
    cssZoom: document.documentElement.style.zoom,
  }));
  expect(metrics).toEqual({ cssWidth: 720, devicePixelRatio: 2, cssZoom: "" });
  await expect(page.getByLabel("Full name required")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
