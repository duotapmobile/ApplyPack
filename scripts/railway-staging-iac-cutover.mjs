import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const CUTOVER_AUTHORIZATION_ENV =
  "APPLYPACK_RAILWAY_IAC_STAGING_CUTOVER_AUTHORIZATION";
export const CUTOVER_AUTHORIZATION_VALUE =
  "apply:fb5a58c4-8ccb-4205-82f9-8b8738c84e56:6633e585-5bcd-4729-b167-2a99628daf86";
export const EXPECTED_RAILWAY_CLI_VERSION = "5.49.6";
export const HOSTED_FETCH_TIMEOUT_MS = 10_000;

export const CUTOVER_BOUND_INPUTS = Object.freeze([
  ".github/workflows/ci.yml",
  ".railway/README.md",
  ".railway/package-lock.json",
  ".railway/package.json",
  ".railway/railway.test.ts",
  ".railway/railway.ts",
  ".railway/tsconfig.json",
  "railway-maintenance.json",
  "railway.maintenance.json",
  "railway.json",
  "scripts/railway-staging-iac-cutover.mjs",
  "scripts/railway-staging-iac-cutover.test.mjs",
  "src/app/api/health/route.ts",
  "src/lib/operations/launch-readiness.ts",
  "src/lib/operations/summary.ts",
  "src/lib/stripe/mode.ts",
  "tests/fixtures/railway-service-instance-contract-5.49.6.json",
  "tests/unit/railway-iac.test.ts",
]);

const EXPECTED = Object.freeze({
  project: { id: "fb5a58c4-8ccb-4205-82f9-8b8738c84e56", name: "Apply Pack" },
  environment: { id: "6633e585-5bcd-4729-b167-2a99628daf86", name: "staging" },
  web: {
    id: "3d379eca-87ac-48ba-9f95-9d69c806a5db",
    instanceId: "29cd1c79-a42b-4499-aaa9-d036ddacc4d1",
    name: "ApplyPack-staging",
  },
  maintenance: {
    id: "866e36fd-2fec-45fd-ba01-7150a789e419",
    instanceId: "2207d73b-ff81-4538-812d-22d368e573de",
    name: "ApplyPack-maintenance",
  },
  publicOrigin: "https://applypack-staging-staging.up.railway.app",
  declaredResources: ["service.ApplyPack-maintenance", "service.ApplyPack-staging"],
});

const EXPECTED_LEGACY_CANONICAL_SHA256 = Object.freeze({
  "railway.json": "8C18D356C0EE16F939A40E69311B81F554D3A7F5DFFBD7B7C14973B72DCF3A58",
  "railway-maintenance.json":
    "EEDFA7D896A451A8BFE6CD53FAF4859243D547777A0544F03E6AA3ED1CC8B106",
  "railway.maintenance.json":
    "EEDFA7D896A451A8BFE6CD53FAF4859243D547777A0544F03E6AA3ED1CC8B106",
});

const TOKEN_SCOPE_QUERY = `query ApplyPackCutoverTokenScope {
  projectToken {
    project { id name }
    environment { id name }
  }
}`;

const EXPECTED_SERVICE_INSTANCE_FIELDS = Object.freeze([
  "activeDeployments",
  "autoInstrumentationEnabled",
  "buildCommand",
  "builder",
  "clearance",
  "clearanceEffective",
  "createdAt",
  "cronSchedule",
  "deletedAt",
  "dockerfilePath",
  "domains",
  "drainingSeconds",
  "edgeConfig",
  "environmentId",
  "hasEverDeployed",
  "healthcheckPath",
  "healthcheckTimeout",
  "id",
  "ipv6EgressEnabled",
  "isUpdatable",
  "latestDeployment",
  "nextCronRunAt",
  "nixpacksPlan",
  "numReplicas",
  "overlapSeconds",
  "preDeployCommand",
  "preDeployTimeoutSeconds",
  "railpackInfo",
  "railwayConfigFile",
  "region",
  "resolvedFileConfig",
  "restartPolicyMaxRetries",
  "restartPolicyType",
  "rootDirectory",
  "service",
  "serviceId",
  "serviceName",
  "sleepApplication",
  "source",
  "startCommand",
  "tracingEnabled",
  "updatedAt",
  "upstreamUrl",
  "watchPatterns",
]);

const EXPECTED_UPDATE_INPUT_FIELDS = Object.freeze([
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
  "registryCredentials",
  "restartPolicyMaxRetries",
  "restartPolicyType",
  "rootDirectory",
  "sleepApplication",
  "source",
  "startCommand",
  "tracingEnabled",
  "watchPatterns",
]);

const PROVIDER_CONTRACT_QUERY = `query ApplyPackCutoverProviderContract {
  serviceInstance: __type(name: "ServiceInstance") { fields { name } }
  serviceInstanceUpdateInput: __type(name: "ServiceInstanceUpdateInput") {
    inputFields { name }
  }
}`;

const TOPOLOGY_QUERY = `query ApplyPackCutoverTopology($environmentId: String!) {
  environment(id: $environmentId) {
    id
    name
    serviceInstances {
      edges {
        node {
          id
          serviceId
          serviceName
          updatedAt
          autoInstrumentationEnabled
          builder
          railwayConfigFile
          resolvedFileConfig { configFile }
          buildCommand
          dockerfilePath
          drainingSeconds
          rootDirectory
          startCommand
          cronSchedule
          healthcheckPath
          healthcheckTimeout
          ipv6EgressEnabled
          nixpacksPlan
          numReplicas
          overlapSeconds
          preDeployCommand
          preDeployTimeoutSeconds
          region
          restartPolicyType
          restartPolicyMaxRetries
          sleepApplication
          source { image repo }
          tracingEnabled
          watchPatterns
          latestDeployment { id status createdAt updatedAt meta }
        }
      }
    }
  }
}`;

const CHECKOUT_LOCK_KEYS = Object.freeze([
  "APP_CHECKOUT_ENABLED",
  "APP_LIVE_PAYMENTS_ENABLED",
  "APP_JOB_BOARD_CHECKOUT_ENABLED",
]);

const ROLLBACK_INPUT_FIELDS = Object.freeze([
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
]);

export class CutoverError extends Error {
  constructor(code) {
    super(code);
    this.name = "CutoverError";
    this.code = code;
  }
}

function fail(code) {
  throw new CutoverError(code);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

export function canonicalSha256(content) {
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  if (text.includes("\0") || text.includes("\uFFFD")) {
    fail("RAILWAY_IAC_BOUND_INPUT_ENCODING_INVALID");
  }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256")
    .update(Buffer.from(normalized, "utf8"))
    .digest("hex")
    .toUpperCase();
}

function parseJsonOutput(output, code) {
  const source = String(output ?? "").trim();
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    if (start < 0) fail(code);
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, index + 1));
          } catch {
            fail(code);
          }
        }
      }
    }
    fail(code);
  }
}

export function scrubCredentialEnv(sourceEnv, { railwayToken } = {}) {
  const scrubbed = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    const normalized = key.toUpperCase();
    if (
      normalized === "RAILWAY_TOKEN" ||
      normalized === "RAILWAY_API_TOKEN" ||
      normalized === CUTOVER_AUTHORIZATION_ENV
    ) {
      continue;
    }
    scrubbed[key] = value;
  }
  if (railwayToken !== undefined) scrubbed.RAILWAY_TOKEN = railwayToken;
  return scrubbed;
}

function exactEnvValue(sourceEnv, expectedKey) {
  const matches = Object.entries(sourceEnv).filter(
    ([key]) => key.toUpperCase() === expectedKey,
  );
  if (matches.length !== 1) return undefined;
  return matches[0][1];
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function requireSuccess(result, code) {
  if (result.status !== 0) fail(code);
  return result;
}

function verifyRailwayCli(run, repoRoot, localEnv) {
  const result = requireSuccess(
    run("railway", ["--version"], { cwd: repoRoot, env: localEnv }),
    "RAILWAY_IAC_CLI_VERSION_UNAVAILABLE",
  );
  if (result.stdout.trim() !== `railway ${EXPECTED_RAILWAY_CLI_VERSION}`) {
    fail("RAILWAY_IAC_CLI_VERSION_MISMATCH");
  }
  return EXPECTED_RAILWAY_CLI_VERSION;
}

function verifyCommittedInputs(run, repoRoot, localEnv, readBoundFile) {
  const status = requireSuccess(
    run("git", ["status", "--porcelain", "--", ...CUTOVER_BOUND_INPUTS], {
      cwd: repoRoot,
      env: localEnv,
    }),
    "RAILWAY_IAC_GIT_STATUS_FAILED",
  ).stdout.trim();
  if (status) fail("RAILWAY_IAC_BOUND_INPUT_DIRTY");

  const boundInputs = {};
  for (const path of CUTOVER_BOUND_INPUTS) {
    const blobOid = requireSuccess(
      run("git", ["rev-parse", `HEAD:${path}`], { cwd: repoRoot, env: localEnv }),
      "RAILWAY_IAC_BOUND_INPUT_MISSING",
    ).stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(blobOid)) fail("RAILWAY_IAC_BOUND_INPUT_BLOB_INVALID");
    const committed = requireSuccess(
      run("git", ["cat-file", "blob", blobOid], { cwd: repoRoot, env: localEnv }),
      "RAILWAY_IAC_BOUND_INPUT_READ_FAILED",
    ).stdout;
    const committedSha256 = canonicalSha256(committed);
    const workingSha256 = canonicalSha256(readBoundFile(resolve(repoRoot, path)));
    if (workingSha256 !== committedSha256) fail("RAILWAY_IAC_BOUND_INPUT_CONTENT_MISMATCH");
    const expectedLegacySha256 = EXPECTED_LEGACY_CANONICAL_SHA256[path];
    if (expectedLegacySha256 && committedSha256 !== expectedLegacySha256) {
      fail("RAILWAY_IAC_LEGACY_HASH_MISMATCH");
    }
    boundInputs[path] = {
      gitBlobOid: blobOid.toLowerCase(),
      canonicalSha256: committedSha256,
    };
  }
  return boundInputs;
}

function ensureReceiptDirectory(repoRoot, receiptDirectory) {
  if (!receiptDirectory || !isAbsolute(receiptDirectory)) {
    fail("RAILWAY_IAC_RECEIPT_DIRECTORY_MUST_BE_ABSOLUTE");
  }
  const resolvedRepo = resolve(repoRoot);
  const resolvedReceipt = resolve(receiptDirectory);
  const relationship = relative(resolvedRepo, resolvedReceipt);
  if (!relationship || (!relationship.startsWith("..") && !isAbsolute(relationship))) {
    fail("RAILWAY_IAC_RECEIPT_DIRECTORY_INSIDE_REPOSITORY");
  }
  mkdirSync(resolvedReceipt, { recursive: true });
  return resolvedReceipt;
}

function validateScope(response) {
  const scope = response?.data?.projectToken;
  if (
    scope?.project?.id !== EXPECTED.project.id ||
    scope?.project?.name !== EXPECTED.project.name ||
    scope?.environment?.id !== EXPECTED.environment.id ||
    scope?.environment?.name !== EXPECTED.environment.name
  ) {
    fail("RAILWAY_IAC_TOKEN_SCOPE_MISMATCH");
  }
  return {
    project: EXPECTED.project,
    environment: EXPECTED.environment,
    tokenScopeMatches: true,
  };
}

function sortedFieldNames(fields) {
  if (!Array.isArray(fields) || fields.some((field) => typeof field?.name !== "string")) {
    fail("RAILWAY_IAC_PROVIDER_CONTRACT_MALFORMED");
  }
  const names = fields.map((field) => field.name).sort();
  if (new Set(names).size !== names.length) {
    fail("RAILWAY_IAC_PROVIDER_CONTRACT_MALFORMED");
  }
  return names;
}

function validateProviderContract(response) {
  const serviceInstanceFields = sortedFieldNames(response?.data?.serviceInstance?.fields);
  const serviceInstanceUpdateInputFields = sortedFieldNames(
    response?.data?.serviceInstanceUpdateInput?.inputFields,
  );
  if (
    JSON.stringify(serviceInstanceFields) !== JSON.stringify(EXPECTED_SERVICE_INSTANCE_FIELDS) ||
    JSON.stringify(serviceInstanceUpdateInputFields) !==
      JSON.stringify(EXPECTED_UPDATE_INPUT_FIELDS)
  ) {
    fail("RAILWAY_IAC_PROVIDER_CONTRACT_MISMATCH");
  }
  const rollbackMutationInputFields = serviceInstanceUpdateInputFields.filter(
    (field) => field !== "registryCredentials",
  );
  if (
    JSON.stringify(rollbackMutationInputFields) !== JSON.stringify(ROLLBACK_INPUT_FIELDS)
  ) {
    fail("RAILWAY_IAC_PROVIDER_CONTRACT_MISMATCH");
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      railwayCliVersion: EXPECTED_RAILWAY_CLI_VERSION,
      serviceInstanceFields,
      serviceInstanceUpdateInputFields,
    }))
    .digest("hex")
    .toUpperCase();
  return {
    railwayCliVersion: EXPECTED_RAILWAY_CLI_VERSION,
    fingerprint,
    serviceInstanceFields,
    serviceInstanceUpdateInputFields,
    rollbackMutationInputFields,
    excludedWriteOnlyFields: ["registryCredentials"],
  };
}

function deploymentCommit(node) {
  return node?.latestDeployment?.meta?.commitHash ?? null;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function deploymentManifestMultiRegionConfig(node) {
  const deployment = node?.latestDeployment;
  if (!deployment || typeof deployment.id !== "string") {
    fail("RAILWAY_IAC_DEPLOYMENT_MANIFEST_MISSING");
  }
  const instanceUpdatedAt = Date.parse(node.updatedAt);
  const deploymentCreatedAt = Date.parse(deployment.createdAt);
  const deploymentUpdatedAt = Date.parse(deployment.updatedAt);
  if (
    !Number.isFinite(instanceUpdatedAt) ||
    !Number.isFinite(deploymentCreatedAt) ||
    !Number.isFinite(deploymentUpdatedAt)
  ) {
    fail("RAILWAY_IAC_DEPLOYMENT_MANIFEST_MALFORMED");
  }
  if (
    deploymentUpdatedAt < deploymentCreatedAt ||
    deploymentUpdatedAt < instanceUpdatedAt
  ) {
    fail("RAILWAY_IAC_DEPLOYMENT_MANIFEST_STALE");
  }
  const deploy = deployment.meta?.serviceManifest?.deploy;
  if (
    !isPlainObject(deploy) ||
    !Object.prototype.hasOwnProperty.call(deploy, "multiRegionConfig")
  ) {
    fail("RAILWAY_IAC_DEPLOYMENT_MANIFEST_MISSING");
  }
  const config = deploy.multiRegionConfig;
  if (config === null) return null;
  if (!isPlainObject(config) || Object.keys(config).length === 0) {
    fail("RAILWAY_IAC_DEPLOYMENT_MANIFEST_MALFORMED");
  }
  for (const [region, settings] of Object.entries(config)) {
    if (
      !/^[a-z0-9][a-z0-9-]{1,63}$/.test(region) ||
      !isPlainObject(settings) ||
      JSON.stringify(Object.keys(settings).sort()) !== JSON.stringify(["numReplicas"]) ||
      !Number.isSafeInteger(settings.numReplicas) ||
      settings.numReplicas < 1
    ) {
      fail("RAILWAY_IAC_DEPLOYMENT_MANIFEST_MALFORMED");
    }
  }
  return config;
}

function validateTopology(response, reviewedSha) {
  const environment = response?.data?.environment;
  if (
    environment?.id !== EXPECTED.environment.id ||
    environment?.name !== EXPECTED.environment.name
  ) {
    fail("RAILWAY_IAC_ENVIRONMENT_IDENTITY_MISMATCH");
  }
  const nodes = environment?.serviceInstances?.edges?.map((edge) => edge?.node) ?? [];
  if (nodes.length !== 2 || nodes.some((node) => !node)) {
    fail("RAILWAY_IAC_SERVICE_TOPOLOGY_MISMATCH");
  }
  const byName = new Map(nodes.map((node) => [node.serviceName, node]));
  const web = byName.get(EXPECTED.web.name);
  const maintenance = byName.get(EXPECTED.maintenance.name);
  if (
    web?.id !== EXPECTED.web.instanceId ||
    web?.serviceId !== EXPECTED.web.id ||
    maintenance?.id !== EXPECTED.maintenance.instanceId ||
    maintenance?.serviceId !== EXPECTED.maintenance.id
  ) {
    fail("RAILWAY_IAC_SERVICE_TOPOLOGY_MISMATCH");
  }
  const multiRegionConfigByServiceId = {};
  for (const node of [web, maintenance]) {
    if (
      node.railwayConfigFile !== null ||
      node.resolvedFileConfig?.configFile !== null
    ) {
      fail("RAILWAY_IAC_CONFIG_FILE_BASELINE_MISMATCH");
    }
    multiRegionConfigByServiceId[node.serviceId] =
      deploymentManifestMultiRegionConfig(node);
    if (
      node.latestDeployment?.status !== "SUCCESS" ||
      deploymentCommit(node) !== reviewedSha
    ) {
      fail("RAILWAY_IAC_DEPLOYED_SHA_MISMATCH");
    }
  }
  if (
    web.healthcheckPath !== "/api/live" ||
    web.healthcheckTimeout !== 120 ||
    web.cronSchedule !== null ||
    maintenance.cronSchedule !== "0 * * * *" ||
    maintenance.buildCommand !== "node --check scripts/run-maintenance-once.mjs" ||
    maintenance.startCommand !== "node scripts/run-maintenance-once.mjs" ||
    maintenance.restartPolicyType !== "NEVER"
  ) {
    fail("RAILWAY_IAC_SERVICE_SETTINGS_MISMATCH");
  }
  return {
    environment: EXPECTED.environment,
    services: nodes,
    multiRegionConfigByServiceId,
  };
}

function validatePlan(plan, sourceTree) {
  const declared = [...(plan?.changeSet?.declared ?? [])].sort();
  if (
    plan?.kind !== "railway.config.plan" ||
    plan?.version !== 1 ||
    plan?.cliVersion !== EXPECTED_RAILWAY_CLI_VERSION ||
    plan?.environmentId !== EXPECTED.environment.id ||
    plan?.sourceTree !== sourceTree ||
    plan?.destructive !== false ||
    plan?.claim !== true ||
    !plan?.configEtag ||
    !plan?.changeSetHash ||
    (plan?.changeSet?.changes?.length ?? -1) !== 0 ||
    (plan?.changeSet?.diagnostics?.length ?? -1) !== 0 ||
    JSON.stringify(declared) !== JSON.stringify(EXPECTED.declaredResources)
  ) {
    fail("RAILWAY_IAC_PLAN_NOT_ZERO_CHANGE");
  }
  return plan;
}

function runApi(run, repoRoot, providerEnv, query, variables = []) {
  const args = ["api", query, "--compact"];
  for (const [key, value] of variables) {
    args.push("--raw-var", `${key}=${value}`);
  }
  const result = requireSuccess(
    run("railway", args, { cwd: repoRoot, env: providerEnv }),
    "RAILWAY_IAC_PROVIDER_QUERY_FAILED",
  );
  return parseJsonOutput(result.stdout, "RAILWAY_IAC_PROVIDER_RESPONSE_INVALID");
}

function validateCheckoutDisabled(run, repoRoot, providerEnv) {
  const result = requireSuccess(
    run(
      "railway",
      [
        "variable",
        "list",
        "--service",
        EXPECTED.web.name,
        "--environment",
        EXPECTED.environment.name,
        "--project",
        EXPECTED.project.id,
        "--json",
      ],
      { cwd: repoRoot, env: providerEnv },
    ),
    "RAILWAY_IAC_CHECKOUT_LOCK_QUERY_FAILED",
  );
  const variables = parseJsonOutput(
    result.stdout,
    "RAILWAY_IAC_CHECKOUT_LOCK_RESPONSE_INVALID",
  );
  if (
    !variables ||
    typeof variables !== "object" ||
    CHECKOUT_LOCK_KEYS.some((key) => variables[key] !== "false")
  ) {
    fail("RAILWAY_IAC_CHECKOUT_NOT_DISABLED");
  }
  return {
    checkoutEnabled: false,
    livePaymentsEnabled: false,
    boardCheckoutEnabled: false,
  };
}

function runPlan(run, repoRoot, providerEnv, outputPath, sourceTree) {
  const result = run(
    "railway",
    [
      "config",
      "plan",
      "--file",
      ".railway/railway.ts",
      "--json",
      "--detailed-exit-code",
      "--out",
      outputPath,
      "--source-tree",
      sourceTree,
    ],
    { cwd: repoRoot, env: providerEnv },
  );
  if (result.status !== 0) fail("RAILWAY_IAC_PLAN_NOT_ZERO_CHANGE");
  const response = parseJsonOutput(result.stdout, "RAILWAY_IAC_PLAN_RESPONSE_INVALID");
  if ((response?.changeSet?.changes?.length ?? -1) !== 0) {
    fail("RAILWAY_IAC_PLAN_NOT_ZERO_CHANGE");
  }
  if (!existsSync(outputPath)) fail("RAILWAY_IAC_PLAN_ARTIFACT_MISSING");
  return validatePlan(
    parseJsonOutput(readFileSync(outputPath, "utf8"), "RAILWAY_IAC_PLAN_ARTIFACT_INVALID"),
    sourceTree,
  );
}

function sanitizeTopology(topology) {
  return {
    environment: topology.environment,
    services: topology.services.map((node) => ({
      serviceId: node.serviceId,
      serviceInstanceId: node.id,
      serviceName: node.serviceName,
      serviceInstanceUpdatedAt: node.updatedAt,
      autoInstrumentationEnabled: node.autoInstrumentationEnabled,
      builder: node.builder,
      railwayConfigFile: node.railwayConfigFile,
      resolvedConfigFile: node.resolvedFileConfig.configFile,
      buildCommand: node.buildCommand,
      dockerfilePath: node.dockerfilePath,
      drainingSeconds: node.drainingSeconds,
      rootDirectory: node.rootDirectory,
      startCommand: node.startCommand,
      cronSchedule: node.cronSchedule,
      healthcheckPath: node.healthcheckPath,
      healthcheckTimeout: node.healthcheckTimeout,
      ipv6EgressEnabled: node.ipv6EgressEnabled,
      multiRegionConfig: topology.multiRegionConfigByServiceId[node.serviceId],
      multiRegionConfigSource:
        "latestDeployment.meta.serviceManifest.deploy.multiRegionConfig",
      nixpacksPlan: node.nixpacksPlan,
      numReplicas: node.numReplicas,
      overlapSeconds: node.overlapSeconds,
      preDeployCommand: node.preDeployCommand,
      preDeployTimeoutSeconds: node.preDeployTimeoutSeconds,
      region: node.region,
      restartPolicyType: node.restartPolicyType,
      restartPolicyMaxRetries: node.restartPolicyMaxRetries,
      sleepApplication: node.sleepApplication,
      source: node.source,
      tracingEnabled: node.tracingEnabled,
      watchPatterns: node.watchPatterns,
      latestDeployment: {
        id: node.latestDeployment.id,
        status: node.latestDeployment.status,
        createdAt: node.latestDeployment.createdAt,
        updatedAt: node.latestDeployment.updatedAt,
        commitHash: deploymentCommit(node),
      },
    })),
  };
}

function rollbackInput(node, multiRegionConfig) {
  const input = {};
  for (const field of ROLLBACK_INPUT_FIELDS) {
    if (field === "multiRegionConfig") {
      input[field] = multiRegionConfig;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(node, field)) {
      fail("RAILWAY_IAC_ROLLBACK_RECEIPT_INCOMPLETE");
    }
    input[field] = node[field];
  }
  if (
    input.railwayConfigFile !== null ||
    input.builder !== "RAILPACK" ||
    input.nixpacksPlan !== null ||
    input.multiRegionConfig?.ams?.numReplicas !== 1 ||
    !Array.isArray(input.watchPatterns) ||
    input.source?.repo !== "duotapmobile/ApplyPack" ||
    input.source?.image !== null
  ) {
    fail("RAILWAY_IAC_ROLLBACK_RECEIPT_INVALID");
  }
  return input;
}

function buildRollbackReceipt(topology) {
  const byName = new Map(topology.services.map((node) => [node.serviceName, node]));
  return {
    schema: "ServiceInstanceUpdateInput",
    environmentId: EXPECTED.environment.id,
    excludedWriteOnlyFields: ["registryCredentials"],
    services: [EXPECTED.maintenance, EXPECTED.web].map((expected) => {
      const node = byName.get(expected.name);
      if (!node || node.serviceId !== expected.id) {
        fail("RAILWAY_IAC_ROLLBACK_RECEIPT_INCOMPLETE");
      }
      return {
        serviceId: expected.id,
        serviceInstanceId: expected.instanceId,
        serviceName: expected.name,
        input: rollbackInput(
          node,
          topology.multiRegionConfigByServiceId[node.serviceId],
        ),
      };
    }),
  };
}

async function fetchHostedJson(fetchImpl, url, timeoutMs, failureCode) {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new CutoverError(failureCode));
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await fetchImpl(url, {
        redirect: "error",
        signal: controller.signal,
      });
      return { response, body: await response.json() };
    })();
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (error instanceof CutoverError) throw error;
    fail(failureCode);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function validateHosted(fetchImpl, reviewedSha, phase, timeoutMs) {
  const prefix = phase === "post" ? "RAILWAY_IAC_POST" : "RAILWAY_IAC_PREFLIGHT";
  const { response: liveResponse, body: live } = await fetchHostedJson(
    fetchImpl,
    `${EXPECTED.publicOrigin}/api/live`,
    timeoutMs,
    `${prefix}_LIVENESS_FAILED`,
  );
  if (liveResponse.status !== 200 || live?.status !== "ok") {
    fail(`${prefix}_LIVENESS_FAILED`);
  }
  const { response: healthResponse, body: health } = await fetchHostedJson(
    fetchImpl,
    `${EXPECTED.publicOrigin}/api/health`,
    timeoutMs,
    `${prefix}_READINESS_NOT_LOCKED`,
  );
  if (
    healthResponse.status !== 503 ||
    health?.status !== "not_ready" ||
    health?.acceptingOrders !== false ||
    health?.releaseSha !== reviewedSha
  ) {
    fail(`${prefix}_READINESS_NOT_LOCKED`);
  }
  if (health?.checks?.maintenance !== true) {
    fail(`${prefix}_MAINTENANCE_NOT_FRESH`);
  }
  return {
    requestTimeoutMs: timeoutMs,
    live: { statusCode: 200, status: "ok" },
    health: {
      statusCode: 503,
      status: "not_ready",
      acceptingOrders: false,
      releaseSha: reviewedSha,
      maintenanceFresh: true,
    },
  };
}

export async function runCutover({
  mode = "dry-run",
  repoRoot = process.cwd(),
  receiptDirectory,
  env = process.env,
  run = defaultRun,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  readBoundFile = readFileSync,
  hostedFetchTimeoutMs = HOSTED_FETCH_TIMEOUT_MS,
} = {}) {
  if (!["dry-run", "execute"].includes(mode)) fail("RAILWAY_IAC_MODE_INVALID");
  if (
    !Number.isSafeInteger(hostedFetchTimeoutMs) ||
    hostedFetchTimeoutMs < 1 ||
    hostedFetchTimeoutMs > 60_000
  ) {
    fail("RAILWAY_IAC_HOSTED_FETCH_TIMEOUT_INVALID");
  }
  if (exactEnvValue(env, CUTOVER_AUTHORIZATION_ENV) !== CUTOVER_AUTHORIZATION_VALUE) {
    fail("RAILWAY_IAC_CUTOVER_NOT_AUTHORIZED");
  }
  const receipts = ensureReceiptDirectory(repoRoot, receiptDirectory);
  const localEnv = scrubCredentialEnv(env);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

  const boundInputs = verifyCommittedInputs(
    run,
    repoRoot,
    localEnv,
    readBoundFile,
  );
  const reviewedSha = requireSuccess(
    run("git", ["rev-parse", "HEAD"], { cwd: repoRoot, env: localEnv }),
    "RAILWAY_IAC_GIT_HEAD_FAILED",
  ).stdout.trim();
  const sourceTree = requireSuccess(
    run("git", ["rev-parse", "HEAD:.railway"], { cwd: repoRoot, env: localEnv }),
    "RAILWAY_IAC_GIT_TREE_FAILED",
  ).stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(reviewedSha) || !/^[0-9a-f]{40}$/i.test(sourceTree)) {
    fail("RAILWAY_IAC_GIT_IDENTITY_INVALID");
  }
  const railwayCliVersion = verifyRailwayCli(run, repoRoot, localEnv);

  requireSuccess(
    run(npm, ["audit", "--prefix", ".railway", "--audit-level=high"], {
      cwd: repoRoot,
      env: localEnv,
    }),
    "RAILWAY_IAC_NESTED_AUDIT_FAILED",
  );
  requireSuccess(
    run(npm, ["run", "typecheck", "--prefix", ".railway"], {
      cwd: repoRoot,
      env: localEnv,
    }),
    "RAILWAY_IAC_NESTED_TYPECHECK_FAILED",
  );
  requireSuccess(
    run(npm, ["test", "--prefix", ".railway"], { cwd: repoRoot, env: localEnv }),
    "RAILWAY_IAC_NESTED_TEST_FAILED",
  );

  if (exactEnvValue(env, "RAILWAY_API_TOKEN") !== undefined) {
    fail("RAILWAY_IAC_ACCOUNT_TOKEN_PROHIBITED");
  }
  const token = exactEnvValue(env, "RAILWAY_TOKEN");
  if (!token || !String(token).trim()) fail("RAILWAY_IAC_STAGING_TOKEN_REQUIRED");
  const providerEnv = scrubCredentialEnv(env, { railwayToken: token });

  const scope = validateScope(runApi(run, repoRoot, providerEnv, TOKEN_SCOPE_QUERY));
  const providerContract = validateProviderContract(
    runApi(run, repoRoot, providerEnv, PROVIDER_CONTRACT_QUERY),
  );
  const topology = validateTopology(
    runApi(run, repoRoot, providerEnv, TOPOLOGY_QUERY, [
      ["environmentId", EXPECTED.environment.id],
    ]),
    reviewedSha,
  );
  const checkoutLock = validateCheckoutDisabled(run, repoRoot, providerEnv);
  const hostedPreflight = await validateHosted(
    fetchImpl,
    reviewedSha,
    "preflight",
    hostedFetchTimeoutMs,
  );
  const rollback = buildRollbackReceipt(topology);

  const preReceipt = {
    kind: "applypack.railway.staging.pre-cutover",
    capturedAt: now().toISOString(),
    reviewedSha,
    sourceTree,
    railwayCliVersion,
    providerContractFingerprint: providerContract.fingerprint,
    scope,
    providerContract,
    boundInputs,
    topology: sanitizeTopology(topology),
    rollback,
    checkoutLock,
    hostedPreflight,
    nullConfigFileSemantics: {
      railwayConfigFile: null,
      resolvedConfigFile: null,
      emptyStringAccepted: false,
    },
    containsVariableValues: false,
  };
  writeFileSync(
    resolve(receipts, "pre-cutover-receipt.json"),
    `${JSON.stringify(preReceipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  const planPath = resolve(receipts, "reviewed-plan.json");
  const confirmPath = resolve(receipts, "confirmation-plan.json");
  const plan = runPlan(run, repoRoot, providerEnv, planPath, sourceTree);
  const pinnedPlanHash = sha256File(planPath);
  const confirmation = runPlan(run, repoRoot, providerEnv, confirmPath, sourceTree);
  if (
    confirmation.configEtag !== plan.configEtag ||
    confirmation.sourceTree !== plan.sourceTree ||
    confirmation.changeSetHash !== plan.changeSetHash ||
    sha256File(planPath) !== pinnedPlanHash
  ) {
    fail("RAILWAY_IAC_PLAN_PIN_CHANGED");
  }

  const planReceipt = {
    kind: "applypack.railway.staging.plan",
    capturedAt: now().toISOString(),
    reviewedSha,
    sourceTree,
    railwayCliVersion,
    providerContractFingerprint: providerContract.fingerprint,
    boundInputHashes: Object.fromEntries(
      Object.entries(boundInputs).map(([path, evidence]) => [
        path,
        evidence.canonicalSha256,
      ]),
    ),
    configEtag: plan.configEtag,
    changeSetHash: plan.changeSetHash,
    pinnedPlanSha256: pinnedPlanHash,
    declared: [...plan.changeSet.declared].sort(),
    add: 0,
    change: 0,
    destroy: 0,
    destructive: false,
    claim: true,
  };
  writeFileSync(
    resolve(receipts, "plan-receipt.json"),
    `${JSON.stringify(planReceipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  if (mode === "dry-run") {
    return {
      status: "RAILWAY_IAC_DRY_RUN_VERIFIED",
      reviewedSha,
      sourceTree,
      railwayCliVersion,
      planSha256: pinnedPlanHash,
      providerWrites: 0,
      tokenRevocationRequired: true,
    };
  }

  validateScope(runApi(run, repoRoot, providerEnv, TOKEN_SCOPE_QUERY));
  const preApplyProviderContract = validateProviderContract(
    runApi(run, repoRoot, providerEnv, PROVIDER_CONTRACT_QUERY),
  );
  if (preApplyProviderContract.fingerprint !== providerContract.fingerprint) {
    fail("RAILWAY_IAC_PROVIDER_CONTRACT_MISMATCH");
  }
  validateTopology(
    runApi(run, repoRoot, providerEnv, TOPOLOGY_QUERY, [
      ["environmentId", EXPECTED.environment.id],
    ]),
    reviewedSha,
  );
  validateCheckoutDisabled(run, repoRoot, providerEnv);
  await validateHosted(fetchImpl, reviewedSha, "preflight", hostedFetchTimeoutMs);
  const apply = run(
    "railway",
    ["config", "apply", "--json", "--yes", "--plan", planPath],
    { cwd: repoRoot, env: providerEnv },
  );
  requireSuccess(apply, "RAILWAY_IAC_PINNED_APPLY_FAILED");

  const postTopology = validateTopology(
    runApi(run, repoRoot, providerEnv, TOPOLOGY_QUERY, [
      ["environmentId", EXPECTED.environment.id],
    ]),
    reviewedSha,
  );
  const postCheckoutLock = validateCheckoutDisabled(run, repoRoot, providerEnv);
  const hosted = await validateHosted(
    fetchImpl,
    reviewedSha,
    "post",
    hostedFetchTimeoutMs,
  );
  const postReceipt = {
    kind: "applypack.railway.staging.post-cutover",
    capturedAt: now().toISOString(),
    reviewedSha,
    sourceTree,
    railwayCliVersion,
    planSha256: pinnedPlanHash,
    providerContractFingerprint: preApplyProviderContract.fingerprint,
    topology: sanitizeTopology(postTopology),
    checkoutLock: postCheckoutLock,
    hosted,
    checkoutLocked: true,
    tokenRevocationRequired: true,
    tokenRevocationVerified: false,
  };
  writeFileSync(
    resolve(receipts, "post-cutover-receipt.json"),
    `${JSON.stringify(postReceipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return {
    status: "RAILWAY_IAC_APPLIED_TOKEN_REVOCATION_REQUIRED",
    reviewedSha,
    planSha256: pinnedPlanHash,
    providerWrites: 1,
    tokenRevocationRequired: true,
  };
}

function parseArguments(argv) {
  let mode;
  let receiptDirectory;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") mode = "dry-run";
    else if (argument === "--execute") mode = "execute";
    else if (argument === "--receipt-dir") receiptDirectory = argv[++index];
    else fail("RAILWAY_IAC_ARGUMENT_INVALID");
  }
  if (!mode || !receiptDirectory) fail("RAILWAY_IAC_ARGUMENT_REQUIRED");
  return { mode, receiptDirectory };
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isMain) {
  try {
    const result = await runCutover(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.tokenRevocationRequired && result.providerWrites > 0) process.exitCode = 3;
  } catch (error) {
    const code = error instanceof CutoverError ? error.code : "RAILWAY_IAC_UNEXPECTED_FAILURE";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
