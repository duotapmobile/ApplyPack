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
test("production pins services to one full main SHA and isolates maintenance and recovery credentials", async () => {
  await withEnvironment({ APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA: sha }, async () => {
    const graph = await production(createRailwayContext({ ...context, command: "plan" }), undefined as never);
    const services = graph.resources?.flat();
    assert.equal(services?.length, 3);
    const serialized = JSON.stringify(graph);
    assert.equal((serialized.match(new RegExp(`"commitSha":"${sha}"`, "g")) || []).length, 3);
    assert.equal((serialized.match(/"checkSuites":true/g) || []).length, 3);
    assert.equal((serialized.match(/"branch":"main"/g) || []).length, 3);
    assert.match(serialized, /ApplyPack-production-maintenance/);
    const maintenance = JSON.stringify(services?.[1]);
    assert.doesNotMatch(maintenance, /STRIPE_|SUPABASE_|AWS_|RESEND_/);
    assert.match(maintenance, /CRON_SECRET/);
    assert.match(maintenance, /\*\/15 \* \* \* \*/);
    const recovery = JSON.stringify(services?.[2]);
    assert.doesNotMatch(recovery, /STRIPE_|SUPABASE_|RESEND_|CRON_SECRET|APP_RECOVERY_RECEIPT_SECRET|"APP_AWS_RA_/);
    assert.match(recovery, /APP_RECOVERY_READER_SECRET/);
    assert.match(recovery, /APP_RECOVERY_COMPLETION_SECRET/);
    assert.match(recovery, /APP_BACKUP_AWS_RA_PROFILE_ARN/);
    assert.match(recovery, /\*\/5 \* \* \* \*/);
    assert.match(recovery, /run-protected-recovery\.mjs/);
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
