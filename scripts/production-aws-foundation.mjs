import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FOUNDATION, buildCreateRequest, canonicalSha256, isFoundationResourceArn, sha256, validateApproval, validateIdentity,
  validateInventory, validatePlan, validateTemplate,
} from "./lib/production-aws-foundation.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const awsExecutable = "C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe";
const sourcePaths = [FOUNDATION.templatePath, "scripts/production-aws-foundation.mjs", "scripts/lib/production-aws-foundation.mjs",
  "scripts/production-aws-foundation.test.mjs", "docs/runbooks/AWS_PRODUCTION_FOUNDATION.md"];
const fail = (code) => { throw new Error(`PRODUCTION_FOUNDATION_${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const within = (candidate, parent) => { const rel = relative(parent, candidate); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };

function readPrivate(path, limit = 1024 * 1024) {
  assert(typeof path === "string" && isAbsolute(path) && lstatSync(path).isFile()
    && !lstatSync(path).isSymbolicLink() && samePath(realpathSync(path), path), "INPUT_PATH_INVALID");
  assert(lstatSync(path).size <= limit, "INPUT_TOO_LARGE");
  return readFileSync(path);
}

function validateOutput(path) {
  assert(typeof path === "string" && isAbsolute(path), "OUTPUT_PATH_INVALID");
  const parent = dirname(path);
  assert(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink()
    && samePath(realpathSync(parent), parent) && !within(realpathSync(parent), realpathSync(repo)), "OUTPUT_PATH_INVALID");
  assert(!existsSync(path), "OUTPUT_ALREADY_EXISTS");
}

function writeEvidence(path, value) {
  validateOutput(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

function git(args, binary = false) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: binary ? null : "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assert(!result.error && result.status === 0, "SOURCE_UNVERIFIED");
  return binary ? result.stdout : result.stdout.trim();
}

function approvedSource(manifest) {
  assert(samePath(git(["rev-parse", "--show-toplevel"]), repo)
    && git(["remote", "get-url", "origin"]) === "https://github.com/duotapmobile/ApplyPack.git"
    && git(["rev-parse", "HEAD"]) === manifest.releaseSha, "SOURCE_IDENTITY_INVALID");
  assert(git(["status", "--porcelain", "--untracked-files=all"]) === "", "SOURCE_DIRTY");
  for (const path of sourcePaths) git(["cat-file", "-e", `${manifest.releaseSha}:${path}`]);
  const bytes = git(["show", `${manifest.releaseSha}:${FOUNDATION.templatePath}`], true);
  const template = validateTemplate(JSON.parse(bytes.toString("utf8")));
  return { template, templateBodySha256: sha256(bytes) };
}

export function parseArguments(args) {
  const allowed = new Set(["--mode", "--manifest", "--manifest-sha256", "--quote", "--quote-sha256", "--output", "--change-set", "--plan-binding-sha256"]);
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    assert(allowed.has(args[index]) && args[index + 1] && !args[index + 1].startsWith("--") && !Object.hasOwn(parsed, args[index]), "ARGUMENT_INVALID");
    parsed[args[index]] = args[index + 1];
  }
  assert(["prepare", "create-plan", "inspect-plan", "execute-plan"].includes(parsed["--mode"]), "MODE_INVALID");
  assert(["--manifest", "--manifest-sha256", "--quote", "--quote-sha256", "--output"].every((name) => parsed[name]), "ARGUMENT_MISSING");
  const inspect = ["inspect-plan", "execute-plan"].includes(parsed["--mode"]);
  assert(Boolean(parsed["--change-set"]) === inspect && Boolean(parsed["--plan-binding-sha256"]) === (parsed["--mode"] === "execute-plan"), "ARGUMENT_INVALID");
  return parsed;
}

function makeAws(manifest) {
  assert(process.platform === "win32", "WINDOWS_REQUIRED");
  const forbidden = Object.keys(process.env).filter((name) => /^AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|CONFIG_FILE|SHARED_CREDENTIALS_FILE|ROLE_ARN|WEB_IDENTITY_TOKEN_FILE|ROLE_SESSION_NAME|CONTAINER_.*|ENDPOINT_URL.*|CA_BUNDLE|DATA_PATH|LOGIN_CACHE_DIRECTORY)$/iu.test(name)
    && process.env[name]);
  assert(forbidden.length === 0, "CREDENTIAL_OVERRIDE_REJECTED");
  const environment = { ...process.env, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_MAX_ATTEMPTS: "1", AWS_PAGER: "" };
  const call = (args, { text = false, absentAllowed = false } = {}) => {
    const result = spawnSync(awsExecutable, [...args, "--profile", manifest.profile, "--region", FOUNDATION.region,
      "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"],
    { encoding: "utf8", env: environment, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    if (absentAllowed && !result.error && result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return "";
    assert(!result.error && result.status === 0, "PROVIDER_CALL_FAILED");
    return text ? result.stdout.trim() : result.stdout.trim() ? JSON.parse(result.stdout) : {};
  };
  // Browser login is temporary and non-root. The explicit manifest selects the
  // actual operator; possessing staging credentials does not approve production.
  assert(call(["configure", "get", "login_session"], { text: true }) === manifest.operatorArn, "LOGIN_IDENTITY_INVALID");
  for (const field of ["credential_process", "source_profile", "credential_source", "web_identity_token_file", "sso_session", "sso_start_url", "role_arn", "aws_access_key_id", "aws_secret_access_key", "aws_session_token", "endpoint_url", "services", "ca_bundle"]) {
    assert(call(["configure", "get", field], { text: true, absentAllowed: true }) === "", "PROFILE_OVERRIDE_REJECTED");
  }
  const configuration = call(["configure", "list"], { text: true });
  const credentials = configuration.split(/\r?\n/u).filter((line) => /^\s*(?:access_key|secret_key)\b/u.test(line)).map((line) => {
    const match = line.includes(":") ? line.match(/^\s*(access_key|secret_key)\s*:\s*[^:\s]+\s*:\s*([^:\s]+)\s*:/u)
      : line.match(/^\s*(access_key|secret_key)\s+\S+\s+(\S+)\s+/u);
    return { name: match?.[1], type: match?.[2] };
  });
  assert(credentials.length === 2 && credentials.every(({ type }) => type === "login")
    && credentials.map(({ name }) => name).sort().join("|") === "access_key|secret_key", "CREDENTIAL_TYPE_INVALID");
  validateIdentity(call(["sts", "get-caller-identity"]), manifest);
  return call;
}

function inventory(aws, manifest, allowedStackId = null) {
  const data = {
    identity: aws(["sts", "get-caller-identity"]),
    stacks: aws(["cloudformation", "describe-stacks"]).Stacks,
    aliases: aws(["kms", "list-aliases"]).Aliases,
    vpcs: aws(["ec2", "describe-vpcs"]).Vpcs,
    routeTables: aws(["ec2", "describe-route-tables"]).RouteTables,
    prefixListEntries: {},
  };
  assert(Array.isArray(data.routeTables), "INVENTORY_UNVERIFIED");
  const prefixListIds = new Set();
  for (const table of data.routeTables) {
    assert(Array.isArray(table?.Routes), "INVENTORY_UNVERIFIED");
    for (const route of table.Routes) if (route?.DestinationPrefixListId !== undefined) {
      assert(typeof route.DestinationPrefixListId === "string" && /^pl-[a-f0-9]+$/u.test(route.DestinationPrefixListId), "INVENTORY_UNVERIFIED");
      prefixListIds.add(route.DestinationPrefixListId);
    }
  }
  for (const id of prefixListIds) data.prefixListEntries[id] = aws(["ec2", "get-managed-prefix-list-entries", "--prefix-list-id", id]).Entries;
  validateInventory(data, manifest, allowedStackId);
  return { checkedAt: new Date().toISOString(), accountId: FOUNDATION.accountId, region: FOUNDATION.region,
    operatorArn: manifest.operatorArn, resourceCounts: Object.fromEntries(["stacks", "aliases", "vpcs", "routeTables"].map((name) => [name, data[name].length])),
    productionStackAbsent: allowedStackId === null, productionAliasAbsent: true, networkCollision: false };
}

export function runProductionFoundation(args) {
  const options = parseArguments(args);
  const approvedInputs = () => validateApproval({ manifest: JSON.parse(readPrivate(options["--manifest"], 64 * 1024).toString("utf8")),
    manifestSha256: options["--manifest-sha256"], quoteBytes: readPrivate(options["--quote"]), quoteSha256: options["--quote-sha256"] });
  const manifest = approvedInputs();
  const source = approvedSource(manifest);
  const request = buildCreateRequest(manifest, source.template);
  const aws = makeAws(manifest);
  const mode = options["--mode"];
  const output = options["--output"];
  validateOutput(output);
  const common = { schemaVersion: "applypack-production-foundation-operation-v1", releaseSha: manifest.releaseSha,
    manifestSha256: canonicalSha256(manifest), quoteSha256: manifest.quoteSha256, templateSha256: FOUNDATION.templateSha256,
    templateBodySha256: source.templateBodySha256, requestSha256: canonicalSha256(request), accountId: FOUNDATION.accountId,
    region: FOUNDATION.region, operatorArn: manifest.operatorArn };
  if (mode === "prepare" || mode === "create-plan") {
    const checkedInventory = inventory(aws, manifest);
    if (mode === "prepare") {
      writeEvidence(output, { ...common, checkedInventory, request, providerMutation: false });
      return "PRODUCTION_FOUNDATION_REQUEST_PREPARED_NO_MUTATION";
    }
    // Persist intent before the only CREATE call. An uncertain result is never
    // retried or cleaned up automatically; inspect this exact named plan first.
    writeEvidence(`${output}.intent.json`, { ...common, checkedInventory, request, phase: "CREATE_CHANGE_SET_REQUESTED" });
    validateIdentity(aws(["sts", "get-caller-identity"]), manifest);
    approvedSource(manifest);
    approvedInputs();
    const created = aws(["cloudformation", "create-change-set", "--cli-input-json", JSON.stringify(request)]);
    assert(isFoundationResourceArn(created.Id, "changeSet", request.ChangeSetName)
      && isFoundationResourceArn(created.StackId, "stack", FOUNDATION.stackName), "CREATED_PLAN_IDENTITY_INVALID");
    writeEvidence(output, { ...common, changeSetId: created.Id, stackId: created.StackId, phase: "PLAN_CREATED_NOT_EXECUTED" });
    return "PRODUCTION_FOUNDATION_PLAN_CREATED_NOT_EXECUTED";
  }
  const changeSetId = options["--change-set"];
  assert(isFoundationResourceArn(changeSetId, "changeSet", request.ChangeSetName), "PLAN_IDENTITY_INVALID");
  const plan = aws(["cloudformation", "describe-change-set", "--change-set-name", changeSetId]);
  assert(plan.ChangeSetId === changeSetId && isFoundationResourceArn(plan.StackId, "stack", FOUNDATION.stackName), "PLAN_IDENTITY_INVALID");
  const stackId = plan.StackId;
  const checkedInventory = inventory(aws, manifest, stackId);
  const stacks = aws(["cloudformation", "describe-stacks", "--stack-name", stackId]).Stacks;
  assert(Array.isArray(stacks) && stacks.length === 1, "STACK_STATE_INVALID");
  const stackResources = aws(["cloudformation", "list-stack-resources", "--stack-name", stackId]).StackResourceSummaries;
  const changeSets = aws(["cloudformation", "list-change-sets", "--stack-name", stackId]).Summaries;
  const providerEnvelope = aws(["cloudformation", "get-template", "--stack-name", stackId, "--change-set-name", changeSetId, "--template-stage", "Original"]);
  const providerTemplate = typeof providerEnvelope.TemplateBody === "string" ? JSON.parse(providerEnvelope.TemplateBody) : providerEnvelope.TemplateBody;
  const reviewed = validatePlan({ plan, stack: stacks[0], stackResources, changeSets, providerTemplate, request, manifest });
  if (mode === "inspect-plan") {
    writeEvidence(output, { ...common, ...reviewed, checkedInventory, phase: "PROTECTED_PLAN_VERIFIED_NOT_EXECUTED" });
    return `PRODUCTION_FOUNDATION_PLAN_BINDING_SHA256=${reviewed.bindingSha256}`;
  }
  assert(options["--plan-binding-sha256"] === reviewed.bindingSha256, "PLAN_APPROVAL_DIGEST_INVALID");
  writeEvidence(`${output}.intent.json`, { ...common, ...reviewed, checkedInventory, phase: "EXECUTION_REQUESTED" });
  validateIdentity(aws(["sts", "get-caller-identity"]), manifest);
  approvedSource(manifest);
  approvedInputs();
  aws(["cloudformation", "execute-change-set", "--change-set-name", reviewed.changeSetId,
    "--client-request-token", `applypack-production-${reviewed.bindingSha256}`]);
  writeEvidence(output, { ...common, ...reviewed, phase: "EXECUTION_REQUESTED_NOT_PROVEN_COMPLETE" });
  return "PRODUCTION_FOUNDATION_EXECUTION_REQUESTED_NOT_PROVEN_COMPLETE";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(runProductionFoundation(process.argv.slice(2))); }
  catch (error) {
    console.error(/^PRODUCTION_FOUNDATION_[A-Z_]+$/u.test(error?.message || "") ? error.message : "PRODUCTION_FOUNDATION_FAILED");
    process.exitCode = 1;
  }
}
