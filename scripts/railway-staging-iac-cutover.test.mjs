import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import {
  CUTOVER_AUTHORIZATION_ENV,
  CUTOVER_AUTHORIZATION_VALUE,
  runCutover,
} from "./railway-staging-iac-cutover.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const reviewedSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const token = "temporary-staging-project-token-for-test";
const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function receiptDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "applypack-railway-cutover-test-"));
  tempDirectories.push(directory);
  return directory;
}

function scopeResponse(overrides = {}) {
  return {
    data: {
      projectToken: {
        project: {
          id: "fb5a58c4-8ccb-4205-82f9-8b8738c84e56",
          name: "Apply Pack",
          ...overrides.project,
        },
        environment: {
          id: "6633e585-5bcd-4729-b167-2a99628daf86",
          name: "staging",
          ...overrides.environment,
        },
      },
    },
  };
}

function topologyResponse({ configFile = null } = {}) {
  return {
    data: {
      environment: {
        id: "6633e585-5bcd-4729-b167-2a99628daf86",
        name: "staging",
        serviceInstances: {
          edges: [
            {
              node: {
                serviceId: "3d379eca-87ac-48ba-9f95-9d69c806a5db",
                serviceName: "ApplyPack-staging",
                railwayConfigFile: configFile,
                resolvedFileConfig: { configFile },
                buildCommand: null,
                rootDirectory: null,
                startCommand: null,
                cronSchedule: null,
                healthcheckPath: "/api/live",
                healthcheckTimeout: 120,
                restartPolicyType: "ON_FAILURE",
                restartPolicyMaxRetries: 3,
                latestDeployment: {
                  id: "web-deployment",
                  status: "SUCCESS",
                  meta: { commitHash: reviewedSha },
                },
              },
            },
            {
              node: {
                serviceId: "866e36fd-2fec-45fd-ba01-7150a789e419",
                serviceName: "ApplyPack-maintenance",
                railwayConfigFile: configFile,
                resolvedFileConfig: { configFile },
                buildCommand: "node --check scripts/run-maintenance-once.mjs",
                rootDirectory: "/",
                startCommand: "node scripts/run-maintenance-once.mjs",
                cronSchedule: "0 * * * *",
                healthcheckPath: null,
                healthcheckTimeout: null,
                restartPolicyType: "NEVER",
                restartPolicyMaxRetries: 10,
                latestDeployment: {
                  id: "maintenance-deployment",
                  status: "SUCCESS",
                  meta: { commitHash: reviewedSha },
                },
              },
            },
          ],
        },
      },
    },
  };
}

function planArtifact({ destructive = false, changes = [] } = {}) {
  return {
    kind: "railway.config.plan",
    version: 1,
    cliVersion: "5.49.6",
    sourceTree,
    environmentId: "6633e585-5bcd-4729-b167-2a99628daf86",
    configEtag: "staging-config-etag",
    changeSetHash: "sha256:zero-change-plan",
    changeSet: {
      changes,
      declared: ["service.ApplyPack-staging", "service.ApplyPack-maintenance"],
      diagnostics: [],
      telemetry: { language: "typescript" },
      version: 1,
    },
    diff: changes.length === 0 ? "No changes." : "Changes pending.",
    destructive,
    claim: true,
  };
}

function createRunner({
  scope = scopeResponse(),
  topology = topologyResponse(),
  plan = planArtifact(),
} = {}) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args: [...args], env: { ...options.env } });
    if (command === "npm" || command === "npm.cmd") {
      return { status: 0, stdout: "ok", stderr: "" };
    }
    if (command === "git" && args[0] === "status") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args.join(" ") === "rev-parse HEAD") {
      return { status: 0, stdout: `${reviewedSha}\n`, stderr: "" };
    }
    if (command === "git" && args.join(" ") === "rev-parse HEAD:.railway") {
      return { status: 0, stdout: `${sourceTree}\n`, stderr: "" };
    }
    if (command === "railway" && args[0] === "api") {
      const body = args[1].includes("projectToken") ? scope : topology;
      return { status: 0, stdout: JSON.stringify(body), stderr: "" };
    }
    if (command === "railway" && args[0] === "config" && args[1] === "plan") {
      const outputPath = args[args.indexOf("--out") + 1];
      writeFileSync(outputPath, JSON.stringify(plan));
      return {
        status: plan.changeSet.changes.length === 0 && !plan.destructive ? 0 : 2,
        stdout: JSON.stringify({ changeSet: plan.changeSet }),
        stderr: "",
      };
    }
    if (command === "railway" && args[0] === "config" && args[1] === "apply") {
      return { status: 0, stdout: JSON.stringify({ status: "ok" }), stderr: "" };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, run };
}

function authorizedEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    [CUTOVER_AUTHORIZATION_ENV]: CUTOVER_AUTHORIZATION_VALUE,
    RAILWAY_TOKEN: token,
    ...overrides,
  };
}

test("dry-run performs audits, exact scope/topology checks, and two pinned zero-change plans without provider writes", async () => {
  const directory = receiptDirectory();
  const { calls, run } = createRunner();
  const result = await runCutover({
    mode: "dry-run",
    repoRoot,
    receiptDirectory: directory,
    env: authorizedEnv(),
    run,
    now: () => new Date("2026-10-05T00:00:00.000Z"),
  });

  assert.equal(result.status, "RAILWAY_IAC_DRY_RUN_VERIFIED");
  assert.equal(result.providerWrites, 0);
  assert.equal(
    calls.filter((call) => call.command === "railway" && call.args[1] === "plan").length,
    2,
  );
  assert.equal(calls.some((call) => call.args.includes("migrate")), false);
  assert.equal(calls.some((call) => call.args.includes("apply")), false);

  const auditIndex = calls.findIndex((call) => call.args[0] === "audit");
  const firstProviderIndex = calls.findIndex((call) => call.command === "railway");
  assert.ok(auditIndex >= 0 && auditIndex < firstProviderIndex);
  assert.equal(calls[auditIndex].env.RAILWAY_TOKEN, undefined);

  const scopeCall = calls.find(
    (call) => call.command === "railway" && call.args[1]?.includes("projectToken"),
  );
  assert.match(scopeCall.args[1], /project\s*\{\s*id name\s*\}/);
  assert.match(scopeCall.args[1], /environment\s*\{\s*id name\s*\}/);

  const receiptText = readFileSync(join(directory, "pre-cutover-receipt.json"), "utf8");
  assert.equal(receiptText.includes(token), false);
  assert.match(receiptText, /"emptyStringAccepted": false/);
});

test("absent and near-match authorization markers stop before any command", async () => {
  for (const marker of [undefined, "true", `${CUTOVER_AUTHORIZATION_VALUE}:extra`]) {
    const directory = receiptDirectory();
    const { calls, run } = createRunner();
    const env = authorizedEnv();
    if (marker === undefined) delete env[CUTOVER_AUTHORIZATION_ENV];
    else env[CUTOVER_AUTHORIZATION_ENV] = marker;
    await assert.rejects(
      runCutover({ mode: "dry-run", repoRoot, receiptDirectory: directory, env, run }),
      { message: "RAILWAY_IAC_CUTOVER_NOT_AUTHORIZED" },
    );
    assert.equal(calls.length, 0);
  }
});

test("wrong nested token identity and account-wide token variables fail closed", async () => {
  const wrongIdentity = createRunner({
    scope: scopeResponse({ environment: { name: "production" } }),
  });
  await assert.rejects(
    runCutover({
      mode: "dry-run",
      repoRoot,
      receiptDirectory: receiptDirectory(),
      env: authorizedEnv(),
      run: wrongIdentity.run,
    }),
    { message: "RAILWAY_IAC_TOKEN_SCOPE_MISMATCH" },
  );

  const accountToken = createRunner();
  await assert.rejects(
    runCutover({
      mode: "dry-run",
      repoRoot,
      receiptDirectory: receiptDirectory(),
      env: authorizedEnv({ RAILWAY_API_TOKEN: "prohibited-account-token" }),
      run: accountToken.run,
    }),
    { message: "RAILWAY_IAC_ACCOUNT_TOKEN_PROHIBITED" },
  );
  assert.equal(accountToken.calls.some((call) => call.command === "railway"), false);
});

test("destructive or changed plans and empty-string config-file baselines are rejected", async () => {
  const changed = createRunner({
    plan: planArtifact({ destructive: true, changes: [{ address: "service.unexpected" }] }),
  });
  await assert.rejects(
    runCutover({
      mode: "dry-run",
      repoRoot,
      receiptDirectory: receiptDirectory(),
      env: authorizedEnv(),
      run: changed.run,
    }),
    { message: "RAILWAY_IAC_PLAN_NOT_ZERO_CHANGE" },
  );
  assert.equal(changed.calls.some((call) => call.args.includes("apply")), false);

  const emptyConfigFile = createRunner({ topology: topologyResponse({ configFile: "" }) });
  await assert.rejects(
    runCutover({
      mode: "dry-run",
      repoRoot,
      receiptDirectory: receiptDirectory(),
      env: authorizedEnv(),
      run: emptyConfigFile.run,
    }),
    { message: "RAILWAY_IAC_CONFIG_FILE_BASELINE_MISMATCH" },
  );
});

test("execute mode uses only the pinned plan, verifies locked health, and requires revocation", async () => {
  const directory = receiptDirectory();
  const { calls, run } = createRunner();
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/live")) {
      return { status: 200, json: async () => ({ status: "ok" }) };
    }
    if (url.endsWith("/api/health")) {
      return {
        status: 503,
        json: async () => ({
          status: "not_ready",
          acceptingOrders: false,
          releaseSha: reviewedSha,
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await runCutover({
    mode: "execute",
    repoRoot,
    receiptDirectory: directory,
    env: authorizedEnv(),
    run,
    fetchImpl,
  });

  assert.equal(result.status, "RAILWAY_IAC_APPLIED_TOKEN_REVOCATION_REQUIRED");
  assert.equal(result.providerWrites, 1);
  assert.equal(result.tokenRevocationRequired, true);
  const applyCalls = calls.filter(
    (call) => call.command === "railway" && call.args[1] === "apply",
  );
  assert.equal(applyCalls.length, 1);
  assert.deepEqual(applyCalls[0].args.slice(0, 5), [
    "config",
    "apply",
    "--json",
    "--yes",
    "--plan",
  ]);
  assert.equal(applyCalls[0].args.includes("--confirm-destructive"), false);
  assert.equal(calls.some((call) => call.args.includes("migrate")), false);
  const postReceipt = readFileSync(join(directory, "post-cutover-receipt.json"), "utf8");
  assert.equal(postReceipt.includes(token), false);
  assert.match(postReceipt, /"acceptingOrders": false/);
  assert.match(postReceipt, /"tokenRevocationRequired": true/);
  assert.match(postReceipt, /"tokenRevocationVerified": false/);
});

test("runbook uses the supported @PATH syntax and documents sequential non-transactional restore", () => {
  const readme = readFileSync(resolve(repoRoot, ".railway/README.md"), "utf8");
  assert.match(readme, /--variables @private-sanitized-web-rollback-variables\.json/);
  assert.match(readme, /--variables @private-sanitized-maintenance-rollback-variables\.json/);
  assert.equal(readme.includes("@<private"), false);
  assert.match(readme, /not transactional/i);
});
