import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import {
  CUTOVER_AUTHORIZATION_ENV,
  CUTOVER_AUTHORIZATION_VALUE,
  CUTOVER_BOUND_INPUTS,
  EXPECTED_RAILWAY_CLI_VERSION,
  HOSTED_FETCH_TIMEOUT_MS,
  canonicalSha256,
  runCutover,
} from "./railway-staging-iac-cutover.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const reviewedSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const token = "temporary-staging-project-token-for-test";
const tempDirectories = [];
const providerFixture = JSON.parse(
  readFileSync(
    resolve(repoRoot, "tests/fixtures/railway-service-instance-contract-5.49.6.json"),
    "utf8",
  ),
);
const expectedRollbackFields = [
  "autoInstrumentationEnabled",
  "buildCommand",
  "builder",
  "cronSchedule",
  "dockerfilePath",
  "drainingSeconds",
  "healthcheckPath",
  "healthcheckTimeout",
  "ipv6EgressEnabled",
  "multiRegionConfig",
  "nixpacksPlan",
  "numReplicas",
  "overlapSeconds",
  "preDeployCommand",
  "preDeployTimeoutSeconds",
  "railwayConfigFile",
  "region",
  "restartPolicyMaxRetries",
  "restartPolicyType",
  "rootDirectory",
  "sleepApplication",
  "source",
  "startCommand",
  "tracingEnabled",
  "watchPatterns",
];

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

function clone(value) {
  return structuredClone(value);
}

function providerContractResponse() {
  return {
    data: {
      serviceInstance: {
        fields: providerFixture.serviceInstanceFields.map((name) => ({ name })),
      },
      serviceInstanceUpdateInput: {
        inputFields: providerFixture.serviceInstanceUpdateInputFields.map((name) => ({ name })),
      },
    },
  };
}

function topologyResponse({ configFile = null, commitHash = reviewedSha } = {}) {
  const response = clone(providerFixture.response);
  for (const { node } of response.data.environment.serviceInstances.edges) {
    node.railwayConfigFile = configFile;
    node.resolvedFileConfig.configFile = configFile;
    node.latestDeployment.meta.commitHash = commitHash;
  }
  return response;
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
  topology,
  providerContract = providerContractResponse(),
  plan = planArtifact(),
  statusOutput = "",
  cliVersion = EXPECTED_RAILWAY_CLI_VERSION,
  gitHead = reviewedSha,
  checkoutVariables = {
    APP_CHECKOUT_ENABLED: "false",
    APP_LIVE_PAYMENTS_ENABLED: "false",
    APP_JOB_BOARD_CHECKOUT_ENABLED: "false",
  },
} = {}) {
  const calls = [];
  const effectiveTopology = topology ?? topologyResponse({ commitHash: gitHead });
  const blobPaths = new Map();
  const committedContent = (path) =>
    readFileSync(resolve(repoRoot, path), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  const run = (command, args, options) => {
    calls.push({ command, args: [...args], env: { ...options.env } });
    if (command === "npm" || command === "npm.cmd") {
      return { status: 0, stdout: "ok", stderr: "" };
    }
    if (command === "git" && args[0] === "status") {
      return { status: 0, stdout: statusOutput, stderr: "" };
    }
    if (command === "git" && args.join(" ") === "rev-parse HEAD") {
      return { status: 0, stdout: `${gitHead}\n`, stderr: "" };
    }
    if (command === "git" && args.join(" ") === "rev-parse HEAD:.railway") {
      return { status: 0, stdout: `${sourceTree}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse" && args[1].startsWith("HEAD:")) {
      const path = args[1].slice("HEAD:".length);
      const oid = createHash("sha1").update(`test-blob:${path}`).digest("hex");
      blobPaths.set(oid, path);
      return { status: 0, stdout: `${oid}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "cat-file" && args[1] === "blob") {
      const path = blobPaths.get(args[2]);
      if (!path) return { status: 1, stdout: "", stderr: "not found" };
      return { status: 0, stdout: committedContent(path), stderr: "" };
    }
    if (command === "railway" && args.length === 1 && args[0] === "--version") {
      return { status: 0, stdout: `railway ${cliVersion}\n`, stderr: "" };
    }
    if (command === "railway" && args[0] === "api") {
      const body = args[1].includes("projectToken")
        ? scope
        : args[1].includes("ApplyPackCutoverProviderContract")
          ? providerContract
          : effectiveTopology;
      return { status: 0, stdout: JSON.stringify(body), stderr: "" };
    }
    if (command === "railway" && args[0] === "variable" && args[1] === "list") {
      return { status: 0, stdout: JSON.stringify(checkoutVariables), stderr: "" };
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

function hostedFetch({
  status = "not_ready",
  acceptingOrders = false,
  maintenance = true,
  omitMaintenance = false,
  releaseSha = reviewedSha,
  healthStatusCode = 503,
} = {}) {
  return async (url) => {
    if (url.endsWith("/api/live")) {
      return { status: 200, json: async () => ({ status: "ok" }) };
    }
    if (url.endsWith("/api/health")) {
      return {
        status: healthStatusCode,
        json: async () => ({
          status,
          acceptingOrders,
          releaseSha,
          checks: omitMaintenance ? {} : { maintenance },
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function providerMutationCalls(calls) {
  return calls.filter(
    (call) => call.command === "railway" && call.args[0] === "config" && call.args[1] === "apply",
  );
}

function options(run, overrides = {}) {
  return {
    mode: "dry-run",
    repoRoot,
    receiptDirectory: receiptDirectory(),
    env: authorizedEnv(),
    run,
    fetchImpl: hostedFetch(),
    ...overrides,
  };
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
    fetchImpl: hostedFetch(),
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
  const firstProviderIndex = calls.findIndex(
    (call) => call.command === "railway" && call.args[0] !== "--version",
  );
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
  const receipt = JSON.parse(receiptText);
  assert.equal(receipt.railwayCliVersion, EXPECTED_RAILWAY_CLI_VERSION);
  assert.deepEqual(Object.keys(receipt.boundInputs), [...CUTOVER_BOUND_INPUTS]);
  assert.equal(
    receipt.boundInputs["railway.json"].canonicalSha256,
    "8C18D356C0EE16F939A40E69311B81F554D3A7F5DFFBD7B7C14973B72DCF3A58",
  );
  assert.equal(receipt.checkoutLock.checkoutEnabled, false);
  assert.equal(receipt.hostedPreflight.requestTimeoutMs, HOSTED_FETCH_TIMEOUT_MS);
  assert.equal(receipt.hostedPreflight.health.maintenanceFresh, true);
  assert.deepEqual(
    receipt.providerContract.serviceInstanceFields,
    providerFixture.serviceInstanceFields,
  );
  assert.deepEqual(
    receipt.providerContract.serviceInstanceUpdateInputFields,
    providerFixture.serviceInstanceUpdateInputFields,
  );
  assert.deepEqual(
    receipt.providerContract.rollbackMutationInputFields,
    expectedRollbackFields,
  );
  assert.deepEqual(
    receipt.providerContract.excludedWriteOnlyFields,
    ["registryCredentials"],
  );
  assert.match(receipt.providerContract.fingerprint, /^[A-F0-9]{64}$/);
  assert.equal(receipt.rollback.services.length, 2);
  const webRollback = receipt.rollback.services.find(
    (entry) => entry.serviceName === "ApplyPack-staging",
  );
  assert.equal(webRollback.serviceInstanceId, "29cd1c79-a42b-4499-aaa9-d036ddacc4d1");
  assert.deepEqual(Object.keys(webRollback.input), expectedRollbackFields);
  assert.deepEqual(webRollback.input, {
    autoInstrumentationEnabled: false,
    buildCommand: null,
    builder: "RAILPACK",
    cronSchedule: null,
    dockerfilePath: null,
    drainingSeconds: null,
    healthcheckPath: "/api/live",
    healthcheckTimeout: 120,
    ipv6EgressEnabled: false,
    multiRegionConfig: { ams: { numReplicas: 1 } },
    nixpacksPlan: null,
    numReplicas: null,
    overlapSeconds: null,
    preDeployCommand: null,
    preDeployTimeoutSeconds: null,
    railwayConfigFile: null,
    region: null,
    restartPolicyMaxRetries: 3,
    restartPolicyType: "ON_FAILURE",
    rootDirectory: null,
    sleepApplication: false,
    source: { image: null, repo: "duotapmobile/ApplyPack" },
    startCommand: null,
    tracingEnabled: false,
    watchPatterns: [],
  });
  const maintenanceRollback = receipt.rollback.services.find(
    (entry) => entry.serviceName === "ApplyPack-maintenance",
  );
  assert.equal(
    maintenanceRollback.serviceInstanceId,
    "2207d73b-ff81-4538-812d-22d368e573de",
  );
  assert.deepEqual(maintenanceRollback.input, {
    autoInstrumentationEnabled: false,
    buildCommand: "node --check scripts/run-maintenance-once.mjs",
    builder: "RAILPACK",
    cronSchedule: "0 * * * *",
    dockerfilePath: null,
    drainingSeconds: null,
    healthcheckPath: null,
    healthcheckTimeout: null,
    ipv6EgressEnabled: false,
    multiRegionConfig: { ams: { numReplicas: 1 } },
    nixpacksPlan: null,
    numReplicas: 1,
    overlapSeconds: null,
    preDeployCommand: null,
    preDeployTimeoutSeconds: null,
    railwayConfigFile: null,
    region: null,
    restartPolicyMaxRetries: 10,
    restartPolicyType: "NEVER",
    rootDirectory: "/",
    sleepApplication: false,
    source: { image: null, repo: "duotapmobile/ApplyPack" },
    startCommand: "node scripts/run-maintenance-once.mjs",
    tracingEnabled: false,
    watchPatterns: [],
  });
  assert.deepEqual(receipt.rollback.excludedWriteOnlyFields, ["registryCredentials"]);
  const topologyReceipt = receipt.topology.services.find(
    (entry) => entry.serviceName === "ApplyPack-staging",
  );
  assert.equal(
    topologyReceipt.multiRegionConfigSource,
    "latestDeployment.meta.serviceManifest.deploy.multiRegionConfig",
  );
});

test("captured live Railway 5.49.6 contract fixture drives topology parsing without a mock-only field", async () => {
  assert.equal(providerFixture.railwayCliVersion, EXPECTED_RAILWAY_CLI_VERSION);
  assert.equal(providerFixture.serviceInstanceFields.includes("multiRegionConfig"), false);
  assert.equal(
    providerFixture.serviceInstanceUpdateInputFields.includes("multiRegionConfig"),
    true,
  );
  for (const { node } of providerFixture.response.data.environment.serviceInstances.edges) {
    assert.equal(Object.hasOwn(node, "multiRegionConfig"), false);
    assert.deepEqual(
      node.latestDeployment.meta.serviceManifest.deploy.multiRegionConfig,
      { ams: { numReplicas: 1 } },
    );
  }

  const fixtureSha =
    providerFixture.response.data.environment.serviceInstances.edges[0].node.latestDeployment
      .meta.commitHash;
  const runner = createRunner({
    gitHead: fixtureSha,
    topology: clone(providerFixture.response),
  });
  const directory = receiptDirectory();
  await runCutover(
    options(runner.run, {
      receiptDirectory: directory,
      fetchImpl: hostedFetch({ releaseSha: fixtureSha }),
    }),
  );
  const receipt = JSON.parse(
    readFileSync(join(directory, "pre-cutover-receipt.json"), "utf8"),
  );
  for (const service of receipt.rollback.services) {
    assert.deepEqual(service.input.multiRegionConfig, { ams: { numReplicas: 1 } });
  }
});

test("live provider contract disappearance or addition fails before topology, plan, or apply", async () => {
  for (const mutate of [
    (contract) => contract.data.serviceInstanceUpdateInput.inputFields.pop(),
    (contract) => contract.data.serviceInstance.fields.push({ name: "unexpectedField" }),
  ]) {
    const contract = providerContractResponse();
    mutate(contract);
    const runner = createRunner({ providerContract: contract });
    await assert.rejects(runCutover(options(runner.run, { mode: "execute" })), {
      message: "RAILWAY_IAC_PROVIDER_CONTRACT_MISMATCH",
    });
    assert.equal(providerMutationCalls(runner.calls).length, 0);
    assert.equal(
      runner.calls.some(
        (call) => call.command === "railway" && call.args[1]?.includes("ApplyPackCutoverTopology"),
      ),
      false,
    );
  }
});

test("missing, malformed, or stale deployment manifests fail before plan or apply", async () => {
  const fixtures = [
    {
      code: "RAILWAY_IAC_DEPLOYMENT_MANIFEST_MISSING",
      mutate: (node) => delete node.latestDeployment,
    },
    {
      code: "RAILWAY_IAC_DEPLOYMENT_MANIFEST_MISSING",
      mutate: (node) => delete node.latestDeployment.meta.serviceManifest,
    },
    {
      code: "RAILWAY_IAC_DEPLOYMENT_MANIFEST_MALFORMED",
      mutate: (node) => {
        node.latestDeployment.meta.serviceManifest.deploy.multiRegionConfig = {
          ams: { numReplicas: 0 },
        };
      },
    },
    {
      code: "RAILWAY_IAC_DEPLOYMENT_MANIFEST_STALE",
      mutate: (node) => {
        node.updatedAt = "2026-10-05T04:07:00.000Z";
      },
    },
  ];
  for (const fixture of fixtures) {
    const topology = topologyResponse();
    fixture.mutate(topology.data.environment.serviceInstances.edges[0].node);
    const runner = createRunner({ topology });
    await assert.rejects(runCutover(options(runner.run, { mode: "execute" })), {
      message: fixture.code,
    });
    assert.equal(providerMutationCalls(runner.calls).length, 0);
    assert.equal(
      runner.calls.some(
        (call) => call.command === "railway" && call.args[0] === "config" && call.args[1] === "plan",
      ),
      false,
    );
  }
});

test("canonical committed-content hashing accepts clean LF and Windows CRLF", () => {
  const lf = '{\n  "startCommand": "npm run start"\n}\n';
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.equal(canonicalSha256(lf), canonicalSha256(crlf));
  assert.notEqual(
    createHash("sha256").update(Buffer.from(lf)).digest("hex"),
    createHash("sha256").update(Buffer.from(crlf)).digest("hex"),
  );
});

test("dirty wrapper, wrapper test, or CI input stops before credential validation or apply", async () => {
  for (const path of [
    "scripts/railway-staging-iac-cutover.mjs",
    "scripts/railway-staging-iac-cutover.test.mjs",
    ".github/workflows/ci.yml",
    ".railway/README.md",
    "tests/fixtures/railway-service-instance-contract-5.49.6.json",
  ]) {
    const runner = createRunner({ statusOutput: ` M ${path}\n` });
    await assert.rejects(runCutover(options(runner.run)), {
      message: "RAILWAY_IAC_BOUND_INPUT_DIRTY",
    });
    assert.equal(providerMutationCalls(runner.calls).length, 0);
    assert.equal(
      runner.calls.some(
        (call) =>
          call.command === "railway" &&
          ["api", "variable", "config"].includes(call.args[0]),
      ),
      false,
    );
  }
});

test("wrong CLI or plan CLI version stops without apply", async () => {
  const wrongCli = createRunner({ cliVersion: "5.49.5" });
  await assert.rejects(runCutover(options(wrongCli.run)), {
    message: "RAILWAY_IAC_CLI_VERSION_MISMATCH",
  });
  assert.equal(providerMutationCalls(wrongCli.calls).length, 0);

  const wrongPlanCli = createRunner({
    plan: { ...planArtifact(), cliVersion: "5.49.5" },
  });
  await assert.rejects(runCutover(options(wrongPlanCli.run)), {
    message: "RAILWAY_IAC_PLAN_NOT_ZERO_CHANGE",
  });
  assert.equal(providerMutationCalls(wrongPlanCli.calls).length, 0);
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
  assert.equal(
    accountToken.calls.some(
      (call) => call.command === "railway" && call.args[0] !== "--version",
    ),
    false,
  );
});

test("enabled checkout variables or an unsafe hosted pre-state prevent apply", async () => {
  const checkoutEnabled = createRunner({
    checkoutVariables: {
      APP_CHECKOUT_ENABLED: "true",
      APP_LIVE_PAYMENTS_ENABLED: "false",
      APP_JOB_BOARD_CHECKOUT_ENABLED: "false",
    },
  });
  await assert.rejects(runCutover(options(checkoutEnabled.run, { mode: "execute" })), {
    message: "RAILWAY_IAC_CHECKOUT_NOT_DISABLED",
  });
  assert.equal(providerMutationCalls(checkoutEnabled.calls).length, 0);

  const unsafeHealth = createRunner();
  await assert.rejects(
    runCutover(
      options(unsafeHealth.run, {
        mode: "execute",
        fetchImpl: hostedFetch({
          status: "ready",
          acceptingOrders: true,
          healthStatusCode: 200,
        }),
      }),
    ),
    { message: "RAILWAY_IAC_PREFLIGHT_READINESS_NOT_LOCKED" },
  );
  assert.equal(providerMutationCalls(unsafeHealth.calls).length, 0);
});

test("stale or missing maintenance heartbeat evidence prevents apply", async () => {
  for (const fixture of [
    { maintenance: false },
    { omitMaintenance: true },
  ]) {
    const runner = createRunner();
    await assert.rejects(
      runCutover(
        options(runner.run, {
          mode: "execute",
          fetchImpl: hostedFetch(fixture),
        }),
      ),
      { message: "RAILWAY_IAC_PREFLIGHT_MAINTENANCE_NOT_FRESH" },
    );
    assert.equal(providerMutationCalls(runner.calls).length, 0);
  }
});

test("bounded AbortController deadlines fail closed for both hosted probes", async () => {
  for (const target of ["live", "health"]) {
    const runner = createRunner();
    const observedSignals = [];
    const fetchImpl = async (url, init) => {
      observedSignals.push(init.signal);
      if (target === "health" && url.endsWith("/api/live")) {
        return { status: 200, json: async () => ({ status: "ok" }) };
      }
      return new Promise(() => {});
    };
    await assert.rejects(
      runCutover(
        options(runner.run, {
          mode: "execute",
          fetchImpl,
          hostedFetchTimeoutMs: 5,
        }),
      ),
      {
        message:
          target === "live"
            ? "RAILWAY_IAC_PREFLIGHT_LIVENESS_FAILED"
            : "RAILWAY_IAC_PREFLIGHT_READINESS_NOT_LOCKED",
      },
    );
    assert.equal(providerMutationCalls(runner.calls).length, 0);
    assert.equal(observedSignals.at(-1).aborted, true);
  }
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
      fetchImpl: hostedFetch(),
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
      fetchImpl: hostedFetch(),
    }),
    { message: "RAILWAY_IAC_CONFIG_FILE_BASELINE_MISMATCH" },
  );
});

test("an incomplete rollback field set fails before planning or apply", async () => {
  const topology = topologyResponse();
  delete topology.data.environment.serviceInstances.edges[0].node.builder;
  const runner = createRunner({ topology });
  await assert.rejects(runCutover(options(runner.run, { mode: "execute" })), {
    message: "RAILWAY_IAC_ROLLBACK_RECEIPT_INCOMPLETE",
  });
  assert.equal(providerMutationCalls(runner.calls).length, 0);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "railway" && call.args[0] === "config" && call.args[1] === "plan",
    ),
    false,
  );
});

test("execute mode uses only the pinned plan, verifies locked health, and requires revocation", async () => {
  const directory = receiptDirectory();
  const { calls, run } = createRunner();
  const fetchImpl = hostedFetch();

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

test("post-apply hosted failure is reported after exactly one pinned apply", async () => {
  const runner = createRunner();
  let healthChecks = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/live")) {
      return { status: 200, json: async () => ({ status: "ok" }) };
    }
    healthChecks += 1;
    if (healthChecks < 3) return hostedFetch()(url);
    return {
      status: 500,
      json: async () => ({
        status: "not_ready",
        acceptingOrders: false,
        releaseSha: reviewedSha,
        checks: { maintenance: true },
      }),
    };
  };

  await assert.rejects(
    runCutover(
      options(runner.run, {
        mode: "execute",
        fetchImpl,
      }),
    ),
    { message: "RAILWAY_IAC_POST_READINESS_NOT_LOCKED" },
  );
  assert.equal(providerMutationCalls(runner.calls).length, 1);
  assert.equal(
    runner.calls.some((call) => call.args.includes("--confirm-destructive")),
    false,
  );
});

test("runbook uses the supported @PATH syntax and documents sequential non-transactional restore", () => {
  const readme = readFileSync(resolve(repoRoot, ".railway/README.md"), "utf8");
  assert.match(readme, /--variables @private-sanitized-web-rollback-variables\.json/);
  assert.match(readme, /--variables @private-sanitized-maintenance-rollback-variables\.json/);
  assert.equal(readme.includes("@<private"), false);
  assert.match(readme, /not transactional/i);
});
