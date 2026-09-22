import { expect, type Page } from "@playwright/test";

export async function waitForHydration(page: Page) {
  // Next dev may replace a WebKit document while restoring its debug channel.
  // Server HTML being visible does not prove keyboard handlers are attached.
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true", { timeout: 30_000 });
}
