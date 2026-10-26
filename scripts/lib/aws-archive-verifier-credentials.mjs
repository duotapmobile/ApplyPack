import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { assertSinglePem, createRefreshingProvider, parseTemporaryCredentials, runRolesAnywhereHelper } from "./aws-roles-anywhere.mjs";
import { S3Client } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { createArchiveEvidenceReader } from "./recovery-archive-evidence.mjs";

export const ARCHIVE_VERIFIER = Object.freeze({ account: "838445019912", region: "us-east-1", deployment: "production",
  roleArn: "arn:aws:iam::838445019912:role/applypack/production/applypack-production-archive-verifier",
  roleName: "applypack-production-archive-verifier", certificateSubject: "CN=applypack-production-archive-verifier",
  helperPath: "/usr/local/bin/aws_signing_helper" });
const prefix = "APP_ARCHIVE_VERIFIER_AWS_RA_";
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const fail = (code) => { throw new Error(`ARCHIVE_VERIFIER_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function validateArchiveVerifierConfiguration(environment = process.env) {
  const v = ARCHIVE_VERIFIER;
  requireValue(environment.APP_ARCHIVE_VERIFICATION_ENABLED === "true" && environment.APP_DEPLOYMENT_ENV === v.deployment
    && environment[`${prefix}DEPLOYMENT_ENV`] === v.deployment && environment.APP_AWS_ACCOUNT_ID === v.account
    && environment.AWS_REGION === v.region, "DISABLED_OR_WRONG_ENVIRONMENT");
  for (const [name, value] of Object.entries(environment)) if (value && /^(AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN|PROFILE|DEFAULT_PROFILE|CONFIG_FILE|SHARED_CREDENTIALS_FILE|ROLE_ARN|WEB_IDENTITY_TOKEN_FILE|CONTAINER_.*|ENDPOINT_URL.*|CA_BUNDLE)|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS)$/iu.test(name)) fail("CREDENTIAL_OR_TRANSPORT_FALLBACK_FORBIDDEN");
  const trustAnchorArn = environment[`${prefix}TRUST_ANCHOR_ARN`]; const profileArn = environment[`${prefix}PROFILE_ARN`];
  const certificateSha256 = environment[`${prefix}CERTIFICATE_SHA256`]; const caCertificateSha256 = environment[`${prefix}CA_CERTIFICATE_SHA256`];
  requireValue(environment[`${prefix}ROLE_ARN`] === v.roleArn && environment[`${prefix}HELPER_PATH`] === v.helperPath
    && new RegExp(`^arn:aws:rolesanywhere:${v.region}:${v.account}:trust-anchor/${uuid}$`, "u").test(trustAnchorArn || "")
    && new RegExp(`^arn:aws:rolesanywhere:${v.region}:${v.account}:profile/${uuid}$`, "u").test(profileArn || "")
    && /^[a-f0-9]{64}$/u.test(certificateSha256 || "") && /^[a-f0-9]{64}$/u.test(caCertificateSha256 || ""), "IDENTITY_CONFIGURATION");
  return Object.freeze({ ...v, trustAnchorArn, profileArn, certificateSha256, caCertificateSha256 });
}
function material(environment, configuration, now) {
  const buffers = [];
  const decode = (name) => {
    const value = environment[`${prefix}${name}`]; requireValue(typeof value === "string" && value.length <= 32768 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value), "CERTIFICATE_MATERIAL");
    const bytes = Buffer.from(value, "base64"); buffers.push(bytes); requireValue(bytes.toString("base64") === value, "CERTIFICATE_MATERIAL"); return bytes;
  };
  try {
    const certificateBytes = decode("CERTIFICATE_PEM_BASE64"); const caBytes = decode("CA_CERTIFICATE_PEM_BASE64"); const keyBytes = decode("PRIVATE_KEY_PEM_BASE64");
    assertSinglePem(certificateBytes, "certificate"); assertSinglePem(caBytes, "certificate"); assertSinglePem(keyBytes, "privateKey");
    const leaf = new X509Certificate(certificateBytes); const ca = new X509Certificate(caBytes);
    const start = Date.parse(leaf.validFrom); const end = Date.parse(leaf.validTo);
    requireValue(digest(leaf.raw) === configuration.certificateSha256 && digest(ca.raw) === configuration.caCertificateSha256
      && !leaf.ca && ca.ca && leaf.subject === configuration.certificateSubject && leaf.checkIssued(ca) && leaf.verify(ca.publicKey)
      && leaf.checkPrivateKey(createPrivateKey(keyBytes)) && start <= now && end > now + 65 * 60000
      && end - start <= 30 * 86400000 + 1000 && Date.parse(ca.validFrom) <= now && Date.parse(ca.validTo) > end, "CERTIFICATE_BINDING");
    return { certificateBytes, caBytes, keyBytes, clear: () => buffers.forEach((bytes) => bytes.fill(0)) };
  } catch { buffers.forEach((bytes) => bytes.fill(0)); fail("CERTIFICATE_BINDING"); }
}
export function awsArchiveVerifierCredentials(environment = process.env) {
  const configuration = validateArchiveVerifierConfiguration(environment); const binding = JSON.stringify(configuration);
  const provider = createRefreshingProvider(async () => {
    const values = material(environment, configuration, Date.now());
    try {
      const credentials = parseTemporaryCredentials(await runRolesAnywhereHelper(configuration, values));
      const sts = new STSClient({ region: configuration.region, credentials, endpoint: "https://sts.us-east-1.amazonaws.com", maxAttempts: 1 });
      try {
        const identity = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(10000) });
        requireValue(identity.Account === configuration.account && /^arn:aws:sts::838445019912:assumed-role\/applypack-production-archive-verifier\/[A-Za-z0-9+=,.@_-]{1,64}$/u.test(identity.Arn || ""), "CALLER_IDENTITY");
      } finally { sts.destroy(); }
      return credentials;
    } finally { values.clear(); }
  });
  return async () => { requireValue(JSON.stringify(validateArchiveVerifierConfiguration(environment)) === binding, "CONFIGURATION_CHANGED"); return provider(); };
}
/** Separate unattended verifier; the human-MFA recovery-reader is never used.
 * SDK endpoints, account, role, scope and attempts are fixed. */
export function createWorkloadArchiveEvidenceReader(environment = process.env) {
  const credentials = awsArchiveVerifierCredentials(environment);
  const archive = { bucket: "applypack-production-protected-recovery-838445019912", kmsKeyArn: environment.APP_BACKUP_KMS_KEY_ARN };
  const s3 = new S3Client({ region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com", forcePathStyle: true, credentials, maxAttempts: 1 });
  const sts = new STSClient({ region: "us-east-1", endpoint: "https://sts.us-east-1.amazonaws.com", credentials, maxAttempts: 1 });
  try { return { ...createArchiveEvidenceReader({ s3, sts, archive, identity: "verifier" }), close: () => { s3.destroy(); sts.destroy(); } }; }
  catch (error) { s3.destroy(); sts.destroy(); throw error; }
}
