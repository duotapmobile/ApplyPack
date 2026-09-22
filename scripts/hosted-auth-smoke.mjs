import { chromium } from "@playwright/test";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
const origin = "https://applypack-staging-staging.up.railway.app";
const email = process.env.APPLYPACK_REHEARSAL_EMAIL?.trim().toLowerCase();
const approved = (process.env.APP_SAFE_TEST_EMAILS || "").split(",").map(value => value.trim().toLowerCase());
if (!email || !approved.includes(email)) throw new Error("A preapproved rehearsal recipient must be configured");
const directory = resolve("evidence/soft-opening/private");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const evidence = { origin, email, startedAt: new Date().toISOString(), requestStatus: null, verifyStatus: null, signedIn: false };
try {
 await page.goto(origin + "/sign-in?next=/my-applypack");
 await page.getByLabel("Email address", { exact: true }).fill(email);
 const sent = page.waitForResponse(r => r.url().endsWith("/api/auth/email-code/request"));
 await page.getByRole("button", { name: "Send My Sign-In Code", exact: true }).click();
 evidence.requestStatus = (await sent).status();
 if (evidence.requestStatus !== 200) throw new Error("Hosted sign-in request failed with HTTP " + evidence.requestStatus);
 console.log(JSON.stringify({ state: "AWAITING_CODE", email, at: new Date().toISOString() }));
 const reader = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
 const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {reader.close(); reject(new Error("Verification input expired"));}, 240000);
  reader.once("line", line => { clearTimeout(timer); reader.close(); resolve(line.trim()); });
 });
 if (!/^\d{6}$/.test(code)) throw new Error("Invalid verification input format");
 await page.getByLabel("Six-digit code", { exact: true }).fill(code);
 const verified = page.waitForResponse(r => r.url().endsWith("/api/auth/email-code/verify"));
 await page.getByRole("button", { name: "Continue Securely", exact: true }).click();
 evidence.verifyStatus = (await verified).status();
 if (evidence.verifyStatus !== 200) throw new Error("Hosted email verification failed with HTTP " + evidence.verifyStatus);
 await page.waitForURL(url => url.pathname === "/my-applypack");
 evidence.signedIn = true;
 const sessionDirectory = await mkdtemp(resolve(tmpdir(), "applypack-rehearsal-session-"));
 await context.storageState({ path: resolve(sessionDirectory, "state.json") });
 console.log(JSON.stringify({ sessionDirectory, ephemeralSession: true }));
 await page.screenshot({ path: resolve(directory, "authenticated-portal.png"), fullPage: true });
 console.log(JSON.stringify({ state: "VERIFIED", requestStatus: evidence.requestStatus, verifyStatus: evidence.verifyStatus, path: new URL(page.url()).pathname }));
} finally {
 await writeFile(resolve(directory, "auth-result.json"), JSON.stringify(evidence, null, 2));
 await browser.close();
}
