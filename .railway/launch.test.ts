import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRailwayContext } from "railway/iac";
import program from "./launch.ts";
import { launchConfigurationReceipt, launchLockNames, launchMaintenance, launchVariableNames } from "./launch-contract.ts";

const context = { projectId: "fb5a58c4-8ccb-4205-82f9-8b8738c84e56", projectName: "Apply Pack",
  environmentId: "6633e585-5bcd-4729-b167-2a99628daf86", environment: "staging", environmentName: "staging" };
const sha = "a".repeat(40);
const locked = { ...Object.fromEntries(launchLockNames.map((key) => [key, "false"])), APP_DEPLOYMENT_ENV: "staging",
  APP_PAYMENT_MODE: "test", APP_EXPECTED_RELEASE_SHA: sha, APP_MANUAL_LAUNCH_SCOPE: "MANUAL_ONLY",
  APP_SEARCH_CAPACITY_PER_ROLLING_24H: "1", APP_APPLY_PACK_CAPACITY_PER_ROLLING_24H: "2", APP_MAINTENANCE_MAX_AGE_MINUTES: "45" };

test("launch topology uses a separate authorization and rejects production", async () => {
  assert.equal((await program(createRailwayContext({ ...context, command: "plan" }), undefined as never)).name, "Apply Pack");
  await assert.rejects(async () => program(createRailwayContext({ ...context, command: "apply" }), undefined as never), /NOT_AUTHORIZED/);
  await assert.rejects(async () => program(createRailwayContext({ ...context, environment: "production" }), undefined as never), /IDENTITY_MISMATCH/);
});

test("the selected launch JSON and IaC maintenance cadence agree", () => {
  const config = JSON.parse(readFileSync(new URL("../railway.launch.maintenance.json", import.meta.url), "utf8"));
  assert.equal(config.deploy.cronSchedule, launchMaintenance.cronSchedule);
  assert.equal(config.deploy.startCommand, "node scripts/run-maintenance-once.mjs");
  assert.equal(config.deploy.restartPolicyType, "NEVER");
  assert.equal(new Set(launchVariableNames).size, launchVariableNames.length);
});

test("launch services wait for CI and select the non-root Docker package", async () => {
  const graph = await program(createRailwayContext({ ...context, command: "plan" }), undefined as never);
  const serialized = JSON.stringify(graph);
  assert.equal((serialized.match(/"checkSuites":true/g) || []).length, 2);
  assert.equal(serialized.includes('"checkSuites":false'), false);
  const web = JSON.parse(readFileSync(new URL("../railway.launch.web.json", import.meta.url), "utf8"));
  assert.equal(web.build.builder, "DOCKERFILE");
  assert.equal(web.build.dockerfilePath, "Dockerfile.launch");
  assert.ok(serialized.includes("railway.launch.web.json"));
});

test("locked receipt rejects omitted flags, alternate modes, SHA and capacity drift", () => {
  for (const field of launchLockNames) {
    for (const value of [undefined, "False", "true"]) {
      assert.throws(() => launchConfigurationReceipt({ ...locked, [field]: value }, sha), /MISMATCH/);
    }
  }
  for (const [field, value] of Object.entries({ APP_DEPLOYMENT_ENV: "preview", APP_PAYMENT_MODE: "live",
    APP_EXPECTED_RELEASE_SHA: "b".repeat(40), APP_MAINTENANCE_MAX_AGE_MINUTES: "90",
    APP_SEARCH_CAPACITY_PER_ROLLING_24H: "2", APP_APPLY_PACK_CAPACITY_PER_ROLLING_24H: "3" })) {
    assert.throws(() => launchConfigurationReceipt({ ...locked, [field]: value }, sha), /MISMATCH/);
  }
});

test("rollback receipt includes actual lock values and strips sealed values", () => {
  const receipt = launchConfigurationReceipt({ ...locked, STRIPE_SECRET_KEY: "secret-do-not-log", CRON_SECRET: "secret-do-not-log" }, sha);
  assert.equal(receipt.values.APP_REHEARSAL_CHECKOUT_ENABLED, "false");
  assert.equal(JSON.stringify(receipt).includes("secret-do-not-log"), false);
  assert.equal(launchConfigurationReceipt({ ...locked, APP_DEPLOYMENT_ENV: "production", APP_PAYMENT_MODE: "live" }, sha).values.APP_PAYMENT_MODE, "live");
});


test("staging source can align with final main SHA while refusing arbitrary refs", async () => {
  const oldSha = process.env.APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA;
  const oldBranch = process.env.APPLYPACK_RAILWAY_LAUNCH_SOURCE_BRANCH;
  try {
    process.env.APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA = sha;
    process.env.APPLYPACK_RAILWAY_LAUNCH_SOURCE_BRANCH = "main";
    const graph = await program(createRailwayContext({ ...context, command: "plan" }), undefined as never);
    const serialized = JSON.stringify(graph);
    assert.equal((serialized.match(/"branch":"main"/g) || []).length, 2);
    assert.equal((serialized.match(new RegExp(`"commitSha":"${sha}"`, "g")) || []).length, 2);
    assert.equal((serialized.match(new RegExp(`"APP_EXPECTED_RELEASE_SHA":\\{"type":"literal","value":"${sha}"\\}`, "g")) || []).length, 2);
    process.env.APPLYPACK_RAILWAY_LAUNCH_SOURCE_BRANCH = "unreviewed";
    await assert.rejects(async () => program(createRailwayContext({ ...context, command: "plan" }), undefined as never), /SOURCE_BRANCH_INVALID/);
    process.env.APPLYPACK_RAILWAY_LAUNCH_SOURCE_BRANCH = "main";
    process.env.APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA = "main";
    await assert.rejects(async () => program(createRailwayContext({ ...context, command: "plan" }), undefined as never), /RELEASE_SHA_REQUIRED/);
  } finally {
    if (oldSha === undefined) delete process.env.APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA;
    else process.env.APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA = oldSha;
    if (oldBranch === undefined) delete process.env.APPLYPACK_RAILWAY_LAUNCH_SOURCE_BRANCH;
    else process.env.APPLYPACK_RAILWAY_LAUNCH_SOURCE_BRANCH = oldBranch;
  }
});
