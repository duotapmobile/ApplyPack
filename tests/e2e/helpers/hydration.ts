import { expect, type Page, type Response } from "@playwright/test";

const TRANSIENT_NAVIGATION_ERROR = /NS_BINDING_ABORTED|frame load interrupted|interrupted by another navigation|execution context was destroyed/i;

export async function gotoStable(page: Page, url: string): Promise<Response | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: "load" });
      // The app can keep bounded background requests open, so networkidle is not
      // a valid readiness signal. A short post-load window catches Next dev's
      // document replacement without requiring all network activity to stop.
      await page.waitForTimeout(750);
      await expect.poll(() => page.evaluate(() => document.readyState)).toBe("complete");
      return response;
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_NAVIGATION_ERROR.test(String(error)) || attempt === 2) throw error;
      await page.waitForTimeout(250);
    }
  }
  throw lastError;
}

export async function waitForHydration(page: Page) {
  // Next dev may replace a WebKit document while restoring its debug channel.
  // Server HTML being visible does not prove keyboard handlers are attached.
  try {
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true", { timeout: 15_000 });
  } catch (error) {
    if (page.isClosed()) throw error;
    await gotoStable(page, page.url());
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true", { timeout: 30_000 });
  }
}
