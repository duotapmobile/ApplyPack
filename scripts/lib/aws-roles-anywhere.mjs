import { execFile } from "node:child_process";
import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { join, isAbsolute, dirname } from "node:path";

// Reproduced ApplyPack security rebuild of exact AWS source; not an AWS-signed binary.
// Two clean builds and offline regression/scan receipts bind this fixed artifact.
export const SIGNING_HELPER = Object.freeze({ version: "1.8.5+applypack.1",
  upstreamVersion: "1.8.5", sourceCommit: "08f7df47e6da0b58c0e5960c41f5d3601042b1d2",
  sha256: "6bc6af3a10ff0894a552a9a40c414436d0cb91e422262b10e85af61f619d9c9b" });
const account = "838445019912"; // Approved target only; this is not provider verification.
const region = "us-east-1";
const sha = /^[a-f0-9]{64}$/;
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const providers = new Map();

/** @returns {never} */
function denied(code) { throw new Error(`aws_roles_anywhere_${code}`); }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function decoded(value) {
  if (typeof value !== "string" || value.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) denied("sealed_material_invalid");
  return Buffer.from(value, "base64");
}

export function assertSinglePem(bytes, kind) {
  const value = bytes.toString("utf8");
  const pattern = kind === "certificate"
    ? /^\s*-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/
    : /^\s*-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1-----\s*$/;
  if (!pattern.test(value)) denied("pem_envelope_invalid");
}

/** @param {Partial<NodeJS.ProcessEnv>} [environment] */
export function validateRolesAnywhereConfiguration(environment = process.env) {
  const deployment = environment.APP_DEPLOYMENT_ENV;
  if (!["staging", "production"].includes(deployment)
    || environment.APP_AWS_RA_DEPLOYMENT_ENV !== deployment
    || environment.APP_AWS_ACCOUNT_ID !== account || environment.AWS_REGION !== region) denied("environment_invalid");
  const roleArn = `arn:aws:iam::${account}:role/applypack/${deployment}/applypack-${deployment}-railway-caller`;
  const trustAnchorArn = environment.APP_AWS_RA_TRUST_ANCHOR_ARN;
  const profileArn = environment.APP_AWS_RA_PROFILE_ARN;
  if (environment.APP_AWS_RA_ROLE_ARN !== roleArn
    || !new RegExp(`^arn:aws:rolesanywhere:${region}:${account}:trust-anchor/${uuid}$`).test(trustAnchorArn || "")
    || !new RegExp(`^arn:aws:rolesanywhere:${region}:${account}:profile/${uuid}$`).test(profileArn || "")
    || !isAbsolute(environment.APP_AWS_RA_HELPER_PATH || "")
    || environment.APP_AWS_RA_HELPER_PATH !== "/usr/local/bin/aws_signing_helper"
    || !sha.test(environment.APP_AWS_RA_CERTIFICATE_SHA256 || "")
    || !sha.test(environment.APP_AWS_RA_CA_CERTIFICATE_SHA256 || "")) denied("identity_configuration_invalid");
  // No alternate AWS credential source or transport setting is accepted by this caller.
  for (const name of Object.keys(environment)) {
    if (/^(AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN|PROFILE|DEFAULT_PROFILE|CONFIG_FILE|SHARED_CREDENTIALS_FILE|ROLE_ARN|WEB_IDENTITY_TOKEN_FILE|CONTAINER_.*|ENDPOINT_URL.*|CA_BUNDLE)|NODE_TLS_REJECT_UNAUTHORIZED)$/.test(name)
      && environment[name]) denied("alternate_credentials_or_transport");
  }
  return { deployment, account, region, roleArn, trustAnchorArn, profileArn,
    helperPath: environment.APP_AWS_RA_HELPER_PATH,
    certificateSha256: environment.APP_AWS_RA_CERTIFICATE_SHA256,
    caCertificateSha256: environment.APP_AWS_RA_CA_CERTIFICATE_SHA256 };
}

export function inspectCertificateMaterial(environment, configuration, now = Date.now()) {
  let certificateBytes; let caBytes; let keyBytes;
  try {
    certificateBytes = decoded(environment.APP_AWS_RA_CERTIFICATE_PEM_BASE64);
    caBytes = decoded(environment.APP_AWS_RA_CA_CERTIFICATE_PEM_BASE64);
    keyBytes = decoded(environment.APP_AWS_RA_PRIVATE_KEY_PEM_BASE64);
    assertSinglePem(certificateBytes, "certificate");
    assertSinglePem(caBytes, "certificate");
    assertSinglePem(keyBytes, "privateKey");
    const leaf = new X509Certificate(certificateBytes);
    const ca = new X509Certificate(caBytes);
    const privateKey = createPrivateKey(keyBytes);
    const startsAt = Date.parse(leaf.validFrom); const expiresAt = Date.parse(leaf.validTo);
    if (digest(leaf.raw) !== configuration.certificateSha256 || digest(ca.raw) !== configuration.caCertificateSha256
      || leaf.ca || !ca.ca || !leaf.checkIssued(ca) || !leaf.verify(ca.publicKey) || !leaf.checkPrivateKey(privateKey)
      || leaf.subject !== `CN=applypack-${configuration.deployment}-railway-caller`
      || !Number.isFinite(startsAt) || !Number.isFinite(expiresAt) || startsAt > now
      || expiresAt <= now + 65 * 60000 || expiresAt - startsAt > 30 * 86400000 + 1000
      || Date.parse(ca.validFrom) > now || Date.parse(ca.validTo) <= expiresAt) denied("certificate_binding_invalid");
    return { certificateBytes, caBytes, keyBytes, expiresAt, rotationDue: expiresAt - now <= 7 * 86400000 };
  } catch {
    certificateBytes?.fill(0); caBytes?.fill(0); keyBytes?.fill(0);
    denied("certificate_binding_invalid");
  }
}

/** @param {Partial<NodeJS.ProcessEnv>} [environment] */
export function rolesAnywhereCertificateStatus(environment = process.env) {
  const configuration = validateRolesAnywhereConfiguration(environment);
  const material = inspectCertificateMaterial(environment, configuration);
  try {
    return { deployment: configuration.deployment, account: configuration.account, roleArn: configuration.roleArn,
      certificateSha256: configuration.certificateSha256, expiresAt: new Date(material.expiresAt).toISOString(),
      rotationDue: material.rotationDue, providerVerified: false };
  } finally { material.certificateBytes.fill(0); material.caBytes.fill(0); material.keyBytes.fill(0); }
}

export function parseTemporaryCredentials(output, now = Date.now()) {
  let result;
  try { result = JSON.parse(output); } catch { denied("helper_output_invalid"); }
  const expiration = new Date(result?.Expiration);
  if (result?.Version !== 1 || !/^ASIA[A-Z0-9]{16}$/.test(result.AccessKeyId || "")
    || typeof result.SecretAccessKey !== "string" || result.SecretAccessKey.length !== 40
    || typeof result.SessionToken !== "string" || result.SessionToken.length < 16
    || !Number.isFinite(expiration.getTime()) || expiration.getTime() <= now + 5 * 60000
    || expiration.getTime() > now + 3600000) denied("helper_credentials_invalid");
  return { accessKeyId: result.AccessKeyId, secretAccessKey: result.SecretAccessKey,
    sessionToken: result.SessionToken, expiration };
}

export function assertCallerIdentity(identity, configuration) {
  const expected = `arn:aws:sts::${configuration.account}:assumed-role/applypack-${configuration.deployment}-railway-caller/`;
  if (identity?.Account !== configuration.account || !identity?.Arn?.startsWith(expected)
    || !/^[A-Za-z0-9+=,.@_-]{1,64}$/.test(identity.Arn.slice(expected.length))) denied("caller_identity_mismatch");
}

/** Pure cache engine for deterministic local tests; never changes hosted target validation. */
export function createRefreshingProvider(refresh, now = Date.now) {
  let cached; let pending;
  return async () => {
    if (cached && cached.expiration.getTime() > now() + 5 * 60000) return cached;
    if (!pending) pending = Promise.resolve().then(refresh).then((value) => {
      cached = value; return value;
    }).catch(() => { cached = undefined; denied("refresh_failed"); }).finally(() => { pending = undefined; });
    return pending;
  };
}

async function runHelper(configuration, material) {
  if (process.platform !== "linux" || process.arch !== "x64" || process.getuid() === 0) denied("runtime_platform_unsupported");
  const executable = realpathSync(configuration.helperPath);
  const info = lstatSync(configuration.helperPath);
  const ownership = [info];
  for (let parent = dirname(configuration.helperPath);; parent = dirname(parent)) {
    const parentInfo = lstatSync(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) denied("helper_integrity_failed");
    ownership.push(parentInfo);
    if (parent === "/") break;
  }
  assertTrustedHelperMetadata(ownership, process.getuid());
  if (!info.isFile() || info.isSymbolicLink() || executable !== configuration.helperPath
    || digest(readFileSync(executable)) !== SIGNING_HELPER.sha256) denied("helper_integrity_failed");
  const temporaryRoot = realpathSync("/dev/shm");
  if (temporaryRoot !== "/dev/shm" || statfsSync(temporaryRoot).type !== 0x01021994) denied("ephemeral_storage_required");
  const temporary = mkdtempSync(join(temporaryRoot, "applypack-ra-"));
  chmodSync(temporary, 0o700);
  const certificate = join(temporary, "leaf.pem"); const privateKey = join(temporary, "leaf.key");
  try {
    writeFileSync(certificate, material.certificateBytes, { mode: 0o600, flag: "wx" });
    writeFileSync(privateKey, material.keyBytes, { mode: 0o600, flag: "wx" });
    return await new Promise((resolve, reject) => {
      execFile(executable, ["credential-process", "--certificate", certificate, "--private-key", privateKey,
        "--trust-anchor-arn", configuration.trustAnchorArn, "--profile-arn", configuration.profileArn,
        "--role-arn", configuration.roleArn, "--region", region, "--session-duration", "3600"],
      { timeout: 15000, killSignal: "SIGKILL", maxBuffer: 32768, encoding: "utf8", windowsHide: true,
        env: { PATH: "/usr/bin:/bin", HOME: temporary, AWS_REGION: region } },
      (error, stdout) => error ? reject(new Error("aws_roles_anywhere_helper_failed")) : resolve(stdout));
    });
  } finally {
    if (dirname(temporary) !== temporaryRoot || !temporary.startsWith(`${temporaryRoot}/applypack-ra-`)) denied("cleanup_path_invalid");
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function assertTrustedHelperMetadata(entries, runtimeUid) {
  if (runtimeUid === 0 || !entries.length || entries.some((entry) => entry.uid !== 0 || (entry.mode & 0o022) !== 0)) {
    denied("helper_integrity_failed");
  }
}

/** Explicit hosted provider. It never invokes the SDK's default credential chain.
 * @param {Partial<NodeJS.ProcessEnv>} [environment]
 */
export function awsWorkloadCredentials(environment = process.env) {
  const configuration = validateRolesAnywhereConfiguration(environment);
  const cacheKey = JSON.stringify(configuration);
  if (!providers.has(cacheKey)) providers.set(cacheKey, createRefreshingProvider(async () => {
    const material = inspectCertificateMaterial(environment, configuration);
    try {
      const output = await runHelper(configuration, material);
      const credentials = parseTemporaryCredentials(output);
      // Explicit credentials and endpoint prevent recursive/default-chain identity lookup.
      const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
      const sts = new STSClient({ region, credentials, endpoint: `https://sts.${region}.amazonaws.com`, maxAttempts: 1 });
      try {
        const identity = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(10000) });
        assertCallerIdentity(identity, configuration);
      } finally { sts.destroy(); }
      return credentials;
    } finally { material.certificateBytes.fill(0); material.caBytes.fill(0); material.keyBytes.fill(0); }
  }));
  return providers.get(cacheKey);
}
