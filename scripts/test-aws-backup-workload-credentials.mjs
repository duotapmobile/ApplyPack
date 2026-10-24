import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BACKUP_WORKLOAD, assertBackupCallerIdentity, awsBackupWorkloadCredentials, backupRolesAnywhereCertificateStatus,
  inspectBackupCertificateMaterial, validateBackupRolesAnywhereConfiguration } from "./lib/aws-backup-workload-credentials.mjs";
import { inspectCertificateMaterial, validateRolesAnywhereConfiguration } from "./lib/aws-roles-anywhere.mjs";
import { RETENTION_WORKLOAD, assertRetentionCallerIdentity, inspectRetentionCertificateMaterial,
  validateRetentionRolesAnywhereConfiguration } from "./lib/aws-retention-workload-credentials.mjs";

const prefix = "APP_BACKUP_AWS_RA_";
const configuration = { APP_DEPLOYMENT_ENV: "production", APP_BACKUP_AWS_RA_DEPLOYMENT_ENV: "production",
  APP_AWS_ACCOUNT_ID: BACKUP_WORKLOAD.account, AWS_REGION: BACKUP_WORKLOAD.region,
  APP_BACKUP_AWS_RA_ROLE_ARN: BACKUP_WORKLOAD.roleArn,
  APP_BACKUP_AWS_RA_PROFILE_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:profile/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  APP_BACKUP_AWS_RA_TRUST_ANCHOR_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:trust-anchor/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  APP_BACKUP_AWS_RA_HELPER_PATH: BACKUP_WORKLOAD.helperPath,
  APP_BACKUP_AWS_RA_CERTIFICATE_SHA256: "a".repeat(64), APP_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: "b".repeat(64) };
const certificateHash = (pem) => createHash("sha256").update(new X509Certificate(pem).raw).digest("hex");
const base64 = (value) => Buffer.from(value).toString("base64");
let temporary; let ca; let caKey; let writer; let retention; let web; let restore; let extended; let otherCa; let environment; let now;

function openssl(...args) {
  execFileSync("openssl", args, { cwd: temporary, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}
function makeCa(name) {
  openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
    "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "365", "-subj", `/CN=ApplyPack synthetic test ${name}`,
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  return { certificate: readFileSync(join(temporary, `${name}.pem`)), key: readFileSync(join(temporary, `${name}.key`)) };
}
function makeLeaf(name, subject, days = "30") {
  openssl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
    "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", subject);
  openssl("x509", "-req", "-in", `${name}.csr`, "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
    "-out", `${name}.pem`, "-days", days, "-sha256", "-extfile", "leaf.ext");
  return { certificate: readFileSync(join(temporary, `${name}.pem`)), key: readFileSync(join(temporary, `${name}.key`)) };
}
function withLeaf(leaf) {
  return { ...environment, APP_BACKUP_AWS_RA_CERTIFICATE_SHA256: certificateHash(leaf.certificate),
    APP_BACKUP_AWS_RA_CERTIFICATE_PEM_BASE64: base64(leaf.certificate), APP_BACKUP_AWS_RA_PRIVATE_KEY_PEM_BASE64: base64(leaf.key) };
}
function inspect(candidate = environment, clock = now) {
  return inspectBackupCertificateMaterial(candidate, validateBackupRolesAnywhereConfiguration(candidate), clock);
}
function erase(material) { material.certificateBytes.fill(0); material.caBytes.fill(0); material.keyBytes.fill(0); }

before(() => {
  temporary = mkdtempSync(join(tmpdir(), "applypack-backup-identity-test-"));
  ({ certificate: ca, key: caKey } = makeCa("ca"));
  otherCa = makeCa("unrelated");
  writeFileSync(join(temporary, "leaf.ext"), "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n");
  writer = makeLeaf("writer", "/CN=applypack-production-recovery-writer");
  retention = makeLeaf("retention", "/CN=applypack-production-recovery-retention");
  web = makeLeaf("web", "/CN=applypack-production-railway-caller");
  restore = makeLeaf("restore", "/CN=applypack-production-recovery-operator");
  extended = makeLeaf("extended", "/CN=applypack-production-recovery-writer", "31");
  environment = { ...configuration, APP_BACKUP_AWS_RA_CERTIFICATE_SHA256: certificateHash(writer.certificate),
    APP_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: certificateHash(ca), APP_BACKUP_AWS_RA_CERTIFICATE_PEM_BASE64: base64(writer.certificate),
    APP_BACKUP_AWS_RA_CA_CERTIFICATE_PEM_BASE64: base64(ca), APP_BACKUP_AWS_RA_PRIVATE_KEY_PEM_BASE64: base64(writer.key) };
  now = Date.parse(new X509Certificate(writer.certificate).validFrom) + 60000;
});
after(() => {
  if (temporary && dirname(resolve(temporary)) === resolve(tmpdir()) && temporary.startsWith(join(tmpdir(), "applypack-backup-identity-test-"))) {
    rmSync(temporary, { recursive: true, force: true });
  }
  for (const bytes of [ca, caKey, writer?.certificate, writer?.key, retention?.certificate, retention?.key, web?.certificate, web?.key, restore?.certificate, restore?.key,
    extended?.certificate, extended?.key, otherCa?.certificate, otherCa?.key]) bytes?.fill(0);
});

test("only the fixed production writer configuration is accepted", () => {
  assert.equal(validateBackupRolesAnywhereConfiguration(configuration).roleArn, BACKUP_WORKLOAD.roleArn);
  assert.equal(Object.isFrozen(validateBackupRolesAnywhereConfiguration(configuration)), true);
  assert.doesNotThrow(() => validateBackupRolesAnywhereConfiguration({ ...configuration, APP_AWS_RA_HELPER_PATH: BACKUP_WORKLOAD.helperPath }));
  const invalid = { APP_DEPLOYMENT_ENV: "staging", APP_BACKUP_AWS_RA_DEPLOYMENT_ENV: "staging", APP_AWS_ACCOUNT_ID: "123456789012",
    AWS_REGION: "us-west-2", APP_BACKUP_AWS_RA_ROLE_ARN: BACKUP_WORKLOAD.roleArn.replace("recovery-writer", "railway-caller"),
    APP_BACKUP_AWS_RA_PROFILE_ARN: configuration.APP_BACKUP_AWS_RA_PROFILE_ARN.replace("838445019912", "123456789012"),
    APP_BACKUP_AWS_RA_TRUST_ANCHOR_ARN: configuration.APP_BACKUP_AWS_RA_TRUST_ANCHOR_ARN.replace("us-east-1", "us-west-2"),
    APP_BACKUP_AWS_RA_HELPER_PATH: "/tmp/aws_signing_helper", APP_BACKUP_AWS_RA_CERTIFICATE_SHA256: "", APP_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: "x".repeat(64) };
  for (const [name, value] of Object.entries(invalid)) assert.throws(() => validateBackupRolesAnywhereConfiguration({ ...configuration, [name]: value }));
  for (const name of Object.keys(configuration)) assert.throws(() => validateBackupRolesAnywhereConfiguration({ ...configuration, [name]: undefined }));
});

test("alternate credential chains, transport overrides, and case variants fail closed", () => {
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_PROFILE", "AWS_DEFAULT_PROFILE",
    "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ROLE_ARN", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_STS", "AWS_ENDPOINT_URL_S3", "AWS_CA_BUNDLE",
    "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS"]) {
    for (const spelling of [name, name.toLowerCase()]) {
      assert.throws(() => validateBackupRolesAnywhereConfiguration({ ...configuration, [spelling]: "synthetic" }), /alternate_credentials_or_transport/u);
    }
  }
});

test("web identity and source-database credentials cannot accompany the writer", () => {
  for (const name of ["APP_AWS_RA_ROLE_ARN", "APP_AWS_RA_CERTIFICATE_PEM_BASE64", "APP_AWS_RA_PRIVATE_KEY_PEM_BASE64", "APP_AWS_RA_PROFILE_ARN",
    "APP_AWS_RA_TRUST_ANCHOR_ARN", "app_aws_ra_private_key_pem_base64"]) {
    assert.throws(() => validateBackupRolesAnywhereConfiguration({ ...configuration, [name]: "synthetic" }), /web_identity_forbidden/u);
  }
  assert.throws(() => validateBackupRolesAnywhereConfiguration({ ...configuration, APP_AWS_RA_HELPER_PATH: "/tmp/helper" }), /web_identity_forbidden/u);
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL", "DIRECT_URL", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE"]) {
    assert.throws(() => validateBackupRolesAnywhereConfiguration({ ...configuration, [name]: "synthetic" }), /source_credentials_forbidden/u);
  }
});

test("real synthetic leaf, CA, key, fingerprints, and lifetime must all agree", () => {
  const material = inspect();
  assert.equal(material.rotationDue, false); assert.ok(material.keyBytes.equals(writer.key)); erase(material);
  for (const candidate of [withLeaf(web), withLeaf(restore), withLeaf(extended),
    { ...environment, APP_BACKUP_AWS_RA_PRIVATE_KEY_PEM_BASE64: base64(web.key) },
    { ...environment, APP_BACKUP_AWS_RA_PRIVATE_KEY_PEM_BASE64: base64(caKey) },
    { ...environment, APP_BACKUP_AWS_RA_CERTIFICATE_SHA256: "a".repeat(64) },
    { ...environment, APP_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: "b".repeat(64) },
    { ...environment, APP_BACKUP_AWS_RA_CA_CERTIFICATE_PEM_BASE64: base64(otherCa.certificate), APP_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: certificateHash(otherCa.certificate) },
    withLeaf({ certificate: ca, key: caKey }),
    { ...environment, APP_BACKUP_AWS_RA_CA_CERTIFICATE_PEM_BASE64: base64(writer.certificate), APP_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: certificateHash(writer.certificate) }]) {
    assert.throws(() => inspect(candidate), /^Error: aws_backup_roles_anywhere_certificate_binding_invalid$/u);
  }
});

test("missing, noncanonical, bundled, and injected PEM material is rejected without exposing it", () => {
  for (const field of ["CERTIFICATE_PEM_BASE64", "CA_CERTIFICATE_PEM_BASE64", "PRIVATE_KEY_PEM_BASE64"]) {
    for (const value of [undefined, "", "%%%", "Zg", "A".repeat(32769), base64("synthetic secret must never escape")]) {
      assert.throws(() => inspect({ ...environment, [`${prefix}${field}`]: value }), /^Error: aws_backup_roles_anywhere_certificate_binding_invalid$/u);
    }
  }
  for (const certificate of [Buffer.concat([writer.certificate, ca]), Buffer.concat([writer.certificate, writer.key]), Buffer.concat([writer.certificate, Buffer.from("trailing")])]) {
    assert.throws(() => inspect({ ...environment, APP_BACKUP_AWS_RA_CERTIFICATE_PEM_BASE64: base64(certificate) }), /certificate_binding_invalid/u);
  }
  assert.throws(() => inspect({ ...environment, APP_BACKUP_AWS_RA_PRIVATE_KEY_PEM_BASE64: base64(Buffer.concat([writer.key, caKey])) }), /certificate_binding_invalid/u);
});

test("expiry safety margin, not-yet-valid certificates, and rotation status are enforced", () => {
  const leaf = new X509Certificate(writer.certificate); const expiresAt = Date.parse(leaf.validTo);
  for (const clock of [NaN, Date.parse(leaf.validFrom) - 1, expiresAt - 65 * 60000, expiresAt]) assert.throws(() => inspect(environment, clock), /certificate_binding_invalid/u);
  const material = inspect(environment, expiresAt - 7 * 86400000); assert.equal(material.rotationDue, true); erase(material);
  assert.throws(() => inspectBackupCertificateMaterial(environment, { ...validateBackupRolesAnywhereConfiguration(environment), roleArn: "arbitrary" }, now), /certificate_binding_invalid/u);
});

test("status reports only certificate metadata and never claims provider verification", () => {
  const status = backupRolesAnywhereCertificateStatus(environment);
  assert.equal(status.providerVerified, false); assert.equal(status.roleArn, BACKUP_WORKLOAD.roleArn);
  assert.deepEqual(Object.keys(status).sort(), ["account", "certificateSha256", "deployment", "expiresAt", "providerVerified", "roleArn", "rotationDue"].sort());
  assert.equal(JSON.stringify(status).includes("PRIVATE KEY"), false);
});

test("STS identity must be the exact writer account and assumed-role session", () => {
  const identity = { Account: BACKUP_WORKLOAD.account, Arn: "arn:aws:sts::838445019912:assumed-role/applypack-production-recovery-writer/session1" };
  assertBackupCallerIdentity(identity);
  for (const candidate of [null, {}, { ...identity, Account: "123456789012" }, { ...identity, Arn: 123 },
    { ...identity, Arn: identity.Arn.replace("production", "staging") }, { ...identity, Arn: identity.Arn.replace("recovery-writer", "railway-caller") },
    { ...identity, Arn: identity.Arn.replace("recovery-writer", "recovery-operator") }, { ...identity, Arn: identity.Arn + "/extra" },
    { ...identity, Arn: identity.Arn.replace("session1", "") }, { ...identity, Arn: identity.Arn.replace("session1", "a".repeat(65)) }]) {
    assert.throws(() => assertBackupCallerIdentity(candidate), /caller_identity_mismatch/u);
  }
});

test("web validation remains fixed to its original role and rejects the writer certificate", () => {
  const webEnvironment = { APP_DEPLOYMENT_ENV: "production", APP_AWS_RA_DEPLOYMENT_ENV: "production", APP_AWS_ACCOUNT_ID: BACKUP_WORKLOAD.account,
    AWS_REGION: BACKUP_WORKLOAD.region, APP_AWS_RA_ROLE_ARN: BACKUP_WORKLOAD.roleArn.replace("recovery-writer", "railway-caller"),
    APP_AWS_RA_PROFILE_ARN: configuration.APP_BACKUP_AWS_RA_PROFILE_ARN, APP_AWS_RA_TRUST_ANCHOR_ARN: configuration.APP_BACKUP_AWS_RA_TRUST_ANCHOR_ARN,
    APP_AWS_RA_HELPER_PATH: BACKUP_WORKLOAD.helperPath, APP_AWS_RA_CERTIFICATE_SHA256: certificateHash(writer.certificate),
    APP_AWS_RA_CA_CERTIFICATE_SHA256: certificateHash(ca), APP_AWS_RA_CERTIFICATE_PEM_BASE64: base64(writer.certificate),
    APP_AWS_RA_CA_CERTIFICATE_PEM_BASE64: base64(ca), APP_AWS_RA_PRIVATE_KEY_PEM_BASE64: base64(writer.key) };
  assert.throws(() => validateRolesAnywhereConfiguration({ ...webEnvironment, APP_AWS_RA_ROLE_ARN: BACKUP_WORKLOAD.roleArn }), /identity_configuration_invalid/u);
  assert.throws(() => inspectCertificateMaterial(webEnvironment, validateRolesAnywhereConfiguration(webEnvironment), now), /certificate_binding_invalid/u);
});

test("provider rejects incomplete credentials and changed identities without network or fallback", async () => {
  const provider = awsBackupWorkloadCredentials(configuration);
  await assert.rejects(provider(), /^Error: aws_roles_anywhere_refresh_failed$/u);
  await assert.rejects(provider(), /^Error: aws_roles_anywhere_refresh_failed$/u);
  const mutable = { ...environment }; const fixed = awsBackupWorkloadCredentials(mutable);
  // A different valid profile ARN cannot silently reuse an already-created provider.
  mutable.APP_BACKUP_AWS_RA_PROFILE_ARN = "arn:aws:rolesanywhere:us-east-1:838445019912:profile/cccccccc-cccc-cccc-cccc-cccccccccccc";
  await assert.rejects(fixed(), /identity_configuration_changed/u);
  mutable.APP_BACKUP_AWS_RA_PROFILE_ARN = configuration.APP_BACKUP_AWS_RA_PROFILE_ARN; mutable.AWS_ACCESS_KEY_ID = "synthetic";
  await assert.rejects(fixed(), /alternate_credentials_or_transport/u);
});

test("retention has its own fixed role, leaf, namespace and cannot share writer credentials", () => {
  const retained = Object.fromEntries(Object.entries(environment).map(([name, value]) => [name.replace("APP_BACKUP_AWS_RA_", "APP_RETENTION_AWS_RA_"), value]));
  retained.APP_RETENTION_AWS_RA_ROLE_ARN = RETENTION_WORKLOAD.roleArn;
  retained.APP_RETENTION_AWS_RA_CERTIFICATE_SHA256 = certificateHash(retention.certificate);
  retained.APP_RETENTION_AWS_RA_CERTIFICATE_PEM_BASE64 = base64(retention.certificate);
  retained.APP_RETENTION_AWS_RA_PRIVATE_KEY_PEM_BASE64 = base64(retention.key);
  const configured = validateRetentionRolesAnywhereConfiguration(retained);
  const material = inspectRetentionCertificateMaterial(retained, configured, now); erase(material);
  assert.throws(() => validateRetentionRolesAnywhereConfiguration({ ...retained, APP_RETENTION_AWS_RA_ROLE_ARN: BACKUP_WORKLOAD.roleArn }));
  assert.throws(() => validateRetentionRolesAnywhereConfiguration({ ...retained, APP_BACKUP_AWS_RA_PRIVATE_KEY_PEM_BASE64: "synthetic" }), /backup_identity_forbidden/u);
  assert.throws(() => validateBackupRolesAnywhereConfiguration({ ...environment, APP_RETENTION_AWS_RA_PRIVATE_KEY_PEM_BASE64: "synthetic" }), /retention_identity_forbidden/u);
  const writerLeaf = { ...retained, APP_RETENTION_AWS_RA_CERTIFICATE_SHA256: certificateHash(writer.certificate),
    APP_RETENTION_AWS_RA_CERTIFICATE_PEM_BASE64: base64(writer.certificate), APP_RETENTION_AWS_RA_PRIVATE_KEY_PEM_BASE64: base64(writer.key) };
  assert.throws(() => inspectRetentionCertificateMaterial(writerLeaf, validateRetentionRolesAnywhereConfiguration(writerLeaf), now), /certificate_binding_invalid/u);
  const identity = { Account: RETENTION_WORKLOAD.account, Arn: "arn:aws:sts::838445019912:assumed-role/applypack-production-recovery-retention/session1" };
  assertRetentionCallerIdentity(identity);
  assert.throws(() => assertRetentionCallerIdentity({ ...identity, Arn: identity.Arn.replace("recovery-retention", "recovery-writer") }), /caller_identity_mismatch/u);
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_ENDPOINT_URL_S3", "SUPABASE_SECRET_KEY", "APP_AWS_RA_ROLE_ARN"]) {
    assert.throws(() => validateRetentionRolesAnywhereConfiguration({ ...retained, [name]: "synthetic" }));
  }
});
