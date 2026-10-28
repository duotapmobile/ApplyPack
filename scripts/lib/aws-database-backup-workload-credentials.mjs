import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { assertSinglePem, createRefreshingProvider, parseTemporaryCredentials, runRolesAnywhereHelper } from "./aws-roles-anywhere.mjs";
import { databaseImageMetadata } from "./database-recovery-source.mjs";

export const DATABASE_BACKUP_WORKLOAD = Object.freeze({
  deployment: "production", account: "838445019912", region: "us-east-1",
  roleArn: "arn:aws:iam::838445019912:role/applypack/production/applypack-production-database-backup-writer",
  roleName: "applypack-production-database-backup-writer",
  certificateSubject: "CN=applypack-production-database-backup-writer",
  helperPath: "/usr/local/bin/aws_signing_helper",
});
const prefix = "APP_DATABASE_BACKUP_AWS_RA_";
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const sha256 = /^[a-f0-9]{64}$/u;
const digest = (value) => createHash("sha256").update(value).digest("hex");
/** @returns {never} */
function denied(code) { throw new Error(`aws_database_backup_roles_anywhere_${code}`); }

/** Separate database exporter identity; never reuse the file writer or SDK default chain. */
export function validateDatabaseBackupRolesAnywhereConfiguration(environment = process.env) {
  const { deployment, account, region, roleArn, helperPath } = DATABASE_BACKUP_WORKLOAD;
  if (environment.APP_DEPLOYMENT_ENV !== deployment || environment[`${prefix}DEPLOYMENT_ENV`] !== deployment
    || environment.APP_AWS_ACCOUNT_ID !== account || environment.AWS_REGION !== region) denied("environment_invalid");
  const trustAnchorArn = environment[`${prefix}TRUST_ANCHOR_ARN`];
  const profileArn = environment[`${prefix}PROFILE_ARN`];
  const certificateSha256 = environment[`${prefix}CERTIFICATE_SHA256`];
  const caCertificateSha256 = environment[`${prefix}CA_CERTIFICATE_SHA256`];
  if (environment[`${prefix}ROLE_ARN`] !== roleArn || environment[`${prefix}HELPER_PATH`] !== helperPath
    || !new RegExp(`^arn:aws:rolesanywhere:${region}:${account}:trust-anchor/${uuid}$`, "u").test(trustAnchorArn || "")
    || !new RegExp(`^arn:aws:rolesanywhere:${region}:${account}:profile/${uuid}$`, "u").test(profileArn || "")
    || !sha256.test(certificateSha256 || "") || !sha256.test(caCertificateSha256 || "")) denied("identity_configuration_invalid");
  for (const [name, value] of Object.entries(environment)) {
    if (!value) continue;
    if (/^(AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN|PROFILE|DEFAULT_PROFILE|CONFIG_FILE|SHARED_CREDENTIALS_FILE|ROLE_ARN|WEB_IDENTITY_TOKEN_FILE|CONTAINER_.*|ENDPOINT_URL.*|CA_BUNDLE)|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS)$/iu.test(name)) {
      denied("alternate_credentials_or_transport");
    }
    // The shared image supplies this fixed helper path, but none of its web identity material is reusable.
    if (/^APP_AWS_RA_/iu.test(name) && (name !== "APP_AWS_RA_HELPER_PATH" || value !== helperPath)) denied("web_identity_forbidden");
    if (/^APP_RETENTION_AWS_RA_/iu.test(name)) denied("retention_identity_forbidden");
    if (/^APP_BACKUP_AWS_RA_/iu.test(name)) denied("file_writer_identity_forbidden");
    if (/^(APP_RECOVERY_|CRON_SECRET$)/iu.test(name)) denied("application_capability_forbidden");
    if (/^(?:NEXT_PUBLIC_)?SUPABASE_.*(?:KEY|TOKEN|PASSWORD|SECRET|CONNECTION|DATABASE)/iu.test(name)
      || (!databaseImageMetadata(name) && /^(DATABASE_URL|DIRECT_URL|PG[A-Z_]+)$/iu.test(name))) denied("ambient_source_credentials_forbidden");
  }
  return Object.freeze({ deployment, account, region, roleArn, helperPath, trustAnchorArn, profileArn,
    certificateSha256, caCertificateSha256 });
}

function decodeMaterial(value) {
  if (typeof value !== "string" || value.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) denied("certificate_binding_invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) { bytes.fill(0); denied("certificate_binding_invalid"); }
  return bytes;
}

export function inspectDatabaseBackupCertificateMaterial(environment, configuration, now = Date.now()) {
  let certificateBytes; let caBytes; let keyBytes;
  try {
    // Do not allow callers to substitute the web identity or a different pinned certificate configuration.
    if (JSON.stringify(configuration) !== JSON.stringify(validateDatabaseBackupRolesAnywhereConfiguration(environment))) denied("identity_configuration_invalid");
    certificateBytes = decodeMaterial(environment[`${prefix}CERTIFICATE_PEM_BASE64`]);
    caBytes = decodeMaterial(environment[`${prefix}CA_CERTIFICATE_PEM_BASE64`]);
    keyBytes = decodeMaterial(environment[`${prefix}PRIVATE_KEY_PEM_BASE64`]);
    assertSinglePem(certificateBytes, "certificate"); assertSinglePem(caBytes, "certificate"); assertSinglePem(keyBytes, "privateKey");
    const leaf = new X509Certificate(certificateBytes); const ca = new X509Certificate(caBytes);
    const privateKey = createPrivateKey(keyBytes);
    const startsAt = Date.parse(leaf.validFrom); const expiresAt = Date.parse(leaf.validTo);
    const caStartsAt = Date.parse(ca.validFrom); const caExpiresAt = Date.parse(ca.validTo);
    if (!Number.isFinite(now) || digest(leaf.raw) !== configuration.certificateSha256 || digest(ca.raw) !== configuration.caCertificateSha256
      || leaf.ca || !ca.ca || !leaf.checkIssued(ca) || !leaf.verify(ca.publicKey) || !leaf.checkPrivateKey(privateKey)
      || leaf.subject !== DATABASE_BACKUP_WORKLOAD.certificateSubject
      || !Number.isFinite(startsAt) || !Number.isFinite(expiresAt) || startsAt > now
      || expiresAt <= now + 65 * 60000 || expiresAt - startsAt > 30 * 86400000 + 1000
      || !Number.isFinite(caStartsAt) || !Number.isFinite(caExpiresAt) || caStartsAt > now || caExpiresAt <= expiresAt) denied("certificate_binding_invalid");
    return { certificateBytes, caBytes, keyBytes, expiresAt, rotationDue: expiresAt - now <= 7 * 86400000 };
  } catch {
    certificateBytes?.fill(0); caBytes?.fill(0); keyBytes?.fill(0);
    denied("certificate_binding_invalid");
  }
}

export function databaseBackupRolesAnywhereCertificateStatus(environment = process.env) {
  const configuration = validateDatabaseBackupRolesAnywhereConfiguration(environment);
  const material = inspectDatabaseBackupCertificateMaterial(environment, configuration);
  try {
    return { deployment: configuration.deployment, account: configuration.account, roleArn: configuration.roleArn,
      certificateSha256: configuration.certificateSha256, expiresAt: new Date(material.expiresAt).toISOString(),
      rotationDue: material.rotationDue, providerVerified: false };
  } finally { material.certificateBytes.fill(0); material.caBytes.fill(0); material.keyBytes.fill(0); }
}

export function assertDatabaseBackupCallerIdentity(identity) {
  const expected = `arn:aws:sts::${DATABASE_BACKUP_WORKLOAD.account}:assumed-role/${DATABASE_BACKUP_WORKLOAD.roleName}/`;
  if (identity?.Account !== DATABASE_BACKUP_WORKLOAD.account || typeof identity?.Arn !== "string" || !identity.Arn.startsWith(expected)
    || !/^[A-Za-z0-9+=,.@_-]{1,64}$/u.test(identity.Arn.slice(expected.length))) denied("caller_identity_mismatch");
}

/** Explicit temporary credentials for the separate exporter; the helper receives no database secret. */
export function awsDatabaseBackupWorkloadCredentials(environment = process.env) {
  const configuration = validateDatabaseBackupRolesAnywhereConfiguration(environment);
  const configurationBinding = JSON.stringify(configuration);
  const provider = createRefreshingProvider(async () => {
    const material = inspectDatabaseBackupCertificateMaterial(environment, configuration);
    try {
      const credentials = parseTemporaryCredentials(await runRolesAnywhereHelper(configuration, material));
      const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
      const sts = new STSClient({ region: DATABASE_BACKUP_WORKLOAD.region, credentials,
        endpoint: `https://sts.${DATABASE_BACKUP_WORKLOAD.region}.amazonaws.com`, maxAttempts: 1 });
      try {
        assertDatabaseBackupCallerIdentity(await sts.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(10000) }));
      } finally { sts.destroy(); }
      return credentials;
    } finally { material.certificateBytes.fill(0); material.caBytes.fill(0); material.keyBytes.fill(0); }
  });
  return async () => {
    if (JSON.stringify(validateDatabaseBackupRolesAnywhereConfiguration(environment)) !== configurationBinding) denied("identity_configuration_changed");
    return provider();
  };
}
