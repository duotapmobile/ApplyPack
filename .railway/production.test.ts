import assert from "node:assert/strict";
import { test } from "node:test";
import { createRailwayContext } from "railway/iac";
import production, { productionBinding as binding } from "./production.ts";
import staging from "./launch.ts";

const sha = "a".repeat(40);
const context = { projectId: binding.projectId, projectName: binding.projectName,
  environmentId: binding.environmentId, environment: "production", environmentName: "production" };
function withEnvironment(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const original = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.entries(values).forEach(([name, value]) => value === undefined ? delete process.env[name] : process.env[name] = value);
  return fn().finally(() => Object.entries(original).forEach(([name, value]) => value === undefined ? delete process.env[name] : process.env[name] = value));
}
test("production refuses staging, preview, other project and incomplete identities", async () => {
  for (const delta of [{ environment: "staging" }, { environmentName: "preview" }, { projectId: "wrong" },
    { environmentId: "6633e585-5bcd-4729-b167-2a99628daf86" }, { projectName: "Other" }]) {
    await assert.rejects(async () => production({ ...createRailwayContext({ ...context, command: "plan" }), ...delta }, undefined as never), /IDENTITY_MISMATCH/);
  }
  await assert.rejects(async () => staging(createRailwayContext({ ...context, command: "plan" }), undefined as never), /IDENTITY_MISMATCH/);
});
test("production pins both services to one full main SHA and keeps private maintenance credential scope", async () => {
  await withEnvironment({ APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA: sha }, async () => {
    const graph = await production(createRailwayContext({ ...context, command: "plan" }), undefined as never);
    const services = graph.resources?.flat();
    assert.equal(services?.length, 2);
    const serialized = JSON.stringify(graph);
    assert.equal((serialized.match(new RegExp(`"commitSha":"${sha}"`, "g")) || []).length, 2);
    assert.equal((serialized.match(/"checkSuites":true/g) || []).length, 2);
    assert.equal((serialized.match(/"branch":"main"/g) || []).length, 2);
    assert.match(serialized, /ApplyPack-production-maintenance/);
    const maintenance = JSON.stringify(services?.[1]);
    assert.doesNotMatch(maintenance, /STRIPE_|SUPABASE_|AWS_|RESEND_/);
    assert.match(maintenance, /CRON_SECRET/);
    assert.match(maintenance, /\*\/15 \* \* \* \*/);
    assert.match(JSON.stringify(services?.[0]), /"APP_PAYMENT_MODE":\{"type":"literal","value":"live"\}/);
  });
});
test("apply requires the existing web binding plus separately approved cost digest and exact source", async () => {
  const quote = "b".repeat(64);
  const authorization = `launch:${binding.projectId}:${binding.environmentId}:${binding.webServiceId}:${sha}:${quote}`;
  const values = { APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA: sha,
    APPLYPACK_RAILWAY_PRODUCTION_WEB_SERVICE_ID: binding.webServiceId,
    APPLYPACK_RAILWAY_PRODUCTION_COST_APPROVAL_SHA256: quote,
    APPLYPACK_RAILWAY_LAUNCH_PRODUCTION_AUTHORIZATION: authorization };
  for (const key of Object.keys(values)) {
    await withEnvironment({ ...values, [key]: undefined }, async () => {
      await assert.rejects(async () => production(createRailwayContext({ ...context, command: "apply" }), undefined as never), /REQUIRED|NOT_AUTHORIZED/);
    });
  }
  await withEnvironment(values, async () => {
    assert.equal((await production(createRailwayContext({ ...context, command: "apply" }), undefined as never)).name, "Apply Pack");
  });
});
