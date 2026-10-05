import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const CUTOVER_AUTHORIZATION_ENV =
  "APPLYPACK_RAILWAY_IAC_STAGING_CUTOVER_AUTHORIZATION";
export const CUTOVER_AUTHORIZATION_VALUE =
  "apply:fb5a58c4-8ccb-4205-82f9-8b8738c84e56:6633e585-5bcd-4729-b167-2a99628daf86";

const EXPECTED = Object.freeze({
  project: { id: "fb5a58c4-8ccb-4205-82f9-8b8738c84e56", name: "Apply Pack" },
  environment: { id: "6633e585-5bcd-4729-b167-2a99628daf86", name: "staging" },
  web: { id: "3d379eca-87ac-48ba-9f95-9d69c806a5db", name: "ApplyPack-staging" },
  maintenance: {
    id: "866e36fd-2fec-45fd-ba01-7150a789e419",
    name: "ApplyPack-maintenance",
  },
  publicOrigin: "https://applypack-staging-staging.up.railway.app",
  declaredResources: ["service.ApplyPack-maintenance", "service.ApplyPack-staging"],
});

const EXPECTED_LEGACY_HASHES = Object.freeze({
  "railway.json": "7A31888BADA01725F4C27037BE591CE0BA00A1A964E5187D31A3D361DD2C4451",
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

const TOPOLOGY_QUERY = `query ApplyPackCutoverTopology($environmentId: String!) {
  environment(id: $environmentId) {
    id
    name
    serviceInstances {
      edges {
        node {
          serviceId
          serviceName
          railwayConfigFile
          resolvedFileConfig { configFile }
          buildCommand
          rootDirectory
          startCommand
          cronSchedule
          healthcheckPath
          healthcheckTimeout
          restartPolicyType
          restartPolicyMaxRetries
          latestDeployment { id status meta }
        }
      }
    }
  }
}`;

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

function deploymentCommit(node) {
  return node?.latestDeployment?.meta?.commitHash ?? null;
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
    web?.serviceId !== EXPECTED.web.id ||
    maintenance?.serviceId !== EXPECTED.maintenance.id
  ) {
    fail("RAILWAY_IAC_SERVICE_TOPOLOGY_MISMATCH");
  }
  for (const node of [web, maintenance]) {
    if (
      node.railwayConfigFile !== null ||
      node.resolvedFileConfig?.configFile !== null
    ) {
      fail("RAILWAY_IAC_CONFIG_FILE_BASELINE_MISMATCH");
    }
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
  return { environment: EXPECTED.environment, services: nodes };
}

function validatePlan(plan, sourceTree) {
  const declared = [...(plan?.changeSet?.declared ?? [])].sort();
  if (
    plan?.kind !== "railway.config.plan" ||
    plan?.version !== 1 ||
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
      serviceName: node.serviceName,
      railwayConfigFile: node.railwayConfigFile,
      resolvedConfigFile: node.resolvedFileConfig.configFile,
      buildCommand: node.buildCommand,
      rootDirectory: node.rootDirectory,
      startCommand: node.startCommand,
      cronSchedule: node.cronSchedule,
      healthcheckPath: node.healthcheckPath,
      healthcheckTimeout: node.healthcheckTimeout,
      restartPolicyType: node.restartPolicyType,
      restartPolicyMaxRetries: node.restartPolicyMaxRetries,
      latestDeployment: {
        id: node.latestDeployment.id,
        status: node.latestDeployment.status,
        commitHash: deploymentCommit(node),
      },
    })),
  };
}

async function validateHosted(fetchImpl) {
  const liveResponse = await fetchImpl(`${EXPECTED.publicOrigin}/api/live`, {
    redirect: "error",
  });
  const live = await liveResponse.json();
  if (liveResponse.status !== 200 || live?.status !== "ok") {
    fail("RAILWAY_IAC_POST_LIVENESS_FAILED");
  }
  const healthResponse = await fetchImpl(`${EXPECTED.publicOrigin}/api/health`, {
    redirect: "error",
  });
  const health = await healthResponse.json();
  if (
    healthResponse.status !== 503 ||
    health?.status !== "not_ready" ||
    health?.acceptingOrders !== false
  ) {
    fail("RAILWAY_IAC_POST_READINESS_NOT_LOCKED");
  }
  return {
    live: { statusCode: 200, status: "ok" },
    health: {
      statusCode: 503,
      status: "not_ready",
      acceptingOrders: false,
      releaseSha: health.releaseSha ?? null,
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
} = {}) {
  if (!["dry-run", "execute"].includes(mode)) fail("RAILWAY_IAC_MODE_INVALID");
  if (exactEnvValue(env, CUTOVER_AUTHORIZATION_ENV) !== CUTOVER_AUTHORIZATION_VALUE) {
    fail("RAILWAY_IAC_CUTOVER_NOT_AUTHORIZED");
  }
  const receipts = ensureReceiptDirectory(repoRoot, receiptDirectory);
  const localEnv = scrubCredentialEnv(env);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

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

  const status = requireSuccess(
    run(
      "git",
      [
        "status",
        "--porcelain",
        "--",
        ".railway",
        "railway.json",
        "railway-maintenance.json",
        "railway.maintenance.json",
      ],
      { cwd: repoRoot, env: localEnv },
    ),
    "RAILWAY_IAC_GIT_STATUS_FAILED",
  ).stdout.trim();
  if (status) fail("RAILWAY_IAC_SOURCE_NOT_COMMITTED");

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

  const legacyHashes = Object.fromEntries(
    Object.entries(EXPECTED_LEGACY_HASHES).map(([name, expectedHash]) => {
      const actualHash = sha256File(resolve(repoRoot, name));
      if (actualHash !== expectedHash) fail("RAILWAY_IAC_LEGACY_HASH_MISMATCH");
      return [name, actualHash];
    }),
  );

  if (exactEnvValue(env, "RAILWAY_API_TOKEN") !== undefined) {
    fail("RAILWAY_IAC_ACCOUNT_TOKEN_PROHIBITED");
  }
  const token = exactEnvValue(env, "RAILWAY_TOKEN");
  if (!token || !String(token).trim()) fail("RAILWAY_IAC_STAGING_TOKEN_REQUIRED");
  const providerEnv = scrubCredentialEnv(env, { railwayToken: token });

  const scope = validateScope(runApi(run, repoRoot, providerEnv, TOKEN_SCOPE_QUERY));
  const topology = validateTopology(
    runApi(run, repoRoot, providerEnv, TOPOLOGY_QUERY, [
      ["environmentId", EXPECTED.environment.id],
    ]),
    reviewedSha,
  );

  const preReceipt = {
    kind: "applypack.railway.staging.pre-cutover",
    capturedAt: now().toISOString(),
    reviewedSha,
    sourceTree,
    scope,
    legacyHashes,
    topology: sanitizeTopology(topology),
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
      planSha256: pinnedPlanHash,
      providerWrites: 0,
      tokenRevocationRequired: true,
    };
  }

  validateScope(runApi(run, repoRoot, providerEnv, TOKEN_SCOPE_QUERY));
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
  const hosted = await validateHosted(fetchImpl);
  const postReceipt = {
    kind: "applypack.railway.staging.post-cutover",
    capturedAt: now().toISOString(),
    reviewedSha,
    sourceTree,
    planSha256: pinnedPlanHash,
    topology: sanitizeTopology(postTopology),
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
