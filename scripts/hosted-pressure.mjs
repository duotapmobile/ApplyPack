import { request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
const origin = "https://applypack-staging-staging.up.railway.app";
const durationMs = Number(process.env.APPLYPACK_PRESSURE_DURATION_MS || 600000);
if (!Number.isInteger(durationMs) || durationMs < 10000 || durationMs > 600000) throw new Error("Duration must be bounded between 10 seconds and 10 minutes");
if (process.env.APPLYPACK_PRESSURE_CONFIRM !== "staging-synthetic") throw new Error("Explicit staging-synthetic acknowledgement required");
const draftCount = Number(process.env.APPLYPACK_PRESSURE_DRAFTS || 10);
if (!Number.isInteger(draftCount) || draftCount < 1 || draftCount > 10) throw new Error("Draft count must be between 1 and 10; sessions reuse their own existing drafts.");
const contexts = [];
const metrics = [];
const inFlight = new Set();
let unexpected = 0, throttledTicks = 0;
const output = resolve("evidence/soft-opening/hosted-pressure");
await mkdir(output, { recursive: true });
const started = Date.now();
try {
 const draftStates = [];
 for (let index = 0; index < 10; index++) {
  const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { origin, "x-applypack-rehearsal": "synthetic-soft-opening" }, timeout: 10000,
   ...(index >= draftCount ? { storageState: draftStates[index % draftCount] } : {}) });
  contexts.push(context);
  if (index < draftCount) {
   const created = await context.post("/api/intake/anonymous-draft");
   if (created.status() !== 201) throw new Error("Synthetic session creation failed with HTTP " + created.status());
   draftStates.push(await context.storageState());
   if (index === 0 && process.env.APPLYPACK_PRESSURE_CONTEXT_STATE_OUTPUT) {
    await writeFile(process.env.APPLYPACK_PRESSURE_CONTEXT_STATE_OUTPUT, JSON.stringify(draftStates[0]), { mode: 0o600, flag: "wx" });
   }
   await new Promise(resolve => setTimeout(resolve, 250));
  }
 }
 const trafficStart = Date.now();
 let cursor = 0;
 while (Date.now() - trafficStart < durationMs && unexpected < 10) {
  const slot = cursor++ % 10;
  if (inFlight.has(slot)) throttledTicks++;
  else {
   inFlight.add(slot);
   const start = performance.now();
   contexts[slot].get("/api/intake/anonymous-draft").then(async response => {
    const valid = response.status() === 200 && Boolean((await response.json()).draft);
    metrics.push({ elapsedMs: performance.now() - start, status: response.status(), valid });
    if (!valid) unexpected++;
   }).catch(() => { unexpected++; metrics.push({ elapsedMs: performance.now() - start, status: 0, valid: false }); })
    .finally(() => inFlight.delete(slot));
  }
  // One request starts per250ms globally: at most4requests/sec across10sessions.
  await new Promise(resolve => setTimeout(resolve, 250));
  if (cursor % 240 === 0) console.log(JSON.stringify({ elapsedSeconds: Math.round((Date.now() - trafficStart) / 1000), completed: metrics.length, unexpected }));
 }
 while (inFlight.size) await new Promise(resolve => setTimeout(resolve, 100));
 const sorted = metrics.map(item => item.elapsedMs).sort((a,b)=>a-b);
 const p95 = sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null;
 const result = { origin, synthetic: true, scope: "ten request sessions reading their own synthetic anonymous drafts", sessions: contexts.length, independentDrafts: draftCount,
  durationMs: Date.now() - trafficStart, maximumRequestsPerSecond: 4, completed: metrics.length, unexpected, throttledTicks,
  p95Ms: p95, passed: unexpected === 0 && p95 !== null && p95 < 2000 && Date.now() - trafficStart >= durationMs,
  queueGrowthVerified: false, paidFulfillmentLoadVerified: false, startedAt: new Date(started).toISOString() };
 await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result));
 if (!result.passed) process.exitCode = 1;
} finally { await Promise.all(contexts.map(context => context.dispose())); }
