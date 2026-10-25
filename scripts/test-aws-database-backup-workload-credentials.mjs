import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DATABASE_BACKUP_WORKLOAD, assertDatabaseBackupCallerIdentity, awsDatabaseBackupWorkloadCredentials,
  databaseBackupRolesAnywhereCertificateStatus, inspectDatabaseBackupCertificateMaterial,
  validateDatabaseBackupRolesAnywhereConfiguration } from "./lib/aws-database-backup-workload-credentials.mjs";

const prefix = "APP_DATABASE_BACKUP_AWS_RA_";
const configuration = { APP_DEPLOYMENT_ENV: "production", APP_DATABASE_BACKUP_AWS_RA_DEPLOYMENT_ENV: "production",
  APP_AWS_ACCOUNT_ID: DATABASE_BACKUP_WORKLOAD.account, AWS_REGION: DATABASE_BACKUP_WORKLOAD.region,
  APP_DATABASE_BACKUP_AWS_RA_ROLE_ARN: DATABASE_BACKUP_WORKLOAD.roleArn,
  APP_DATABASE_BACKUP_AWS_RA_PROFILE_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:profile/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  APP_DATABASE_BACKUP_AWS_RA_TRUST_ANCHOR_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:trust-anchor/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  APP_DATABASE_BACKUP_AWS_RA_HELPER_PATH: DATABASE_BACKUP_WORKLOAD.helperPath,
  APP_DATABASE_BACKUP_AWS_RA_CERTIFICATE_SHA256: "a".repeat(64), APP_DATABASE_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: "b".repeat(64) };
const certificateHash = (pem) => createHash("sha256").update(new X509Certificate(pem).raw).digest("hex");
const base64 = (bytes) => Buffer.from(bytes).toString("base64");
let temporary; let ca; let caKey; let writer; let unrelated; let longLived; let otherCa; let environment; let now;
function openssl(...args) { execFileSync("openssl", args, { cwd: temporary, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); }
function makeCa(name) {
  openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", `${name}.key`,
    "-out", `${name}.pem`, "-days", "365", "-subj", `/CN=ApplyPack synthetic ${name}`,
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  return { certificate: readFileSync(join(temporary, `${name}.pem`)), key: readFileSync(join(temporary, `${name}.key`)) };
}
function makeLeaf(name, subject, days = "30") {
  openssl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
    "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${subject}`);
  openssl("x509", "-req", "-in", `${name}.csr`, "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
    "-out", `${name}.pem`, "-days", days, "-sha256", "-extfile", "leaf.ext");
  return { certificate: readFileSync(join(temporary, `${name}.pem`)), key: readFileSync(join(temporary, `${name}.key`)) };
}
function withLeaf(leaf) {
  return { ...environment, [`${prefix}CERTIFICATE_SHA256`]: certificateHash(leaf.certificate),
    [`${prefix}CERTIFICATE_PEM_BASE64`]: base64(leaf.certificate), [`${prefix}PRIVATE_KEY_PEM_BASE64`]: base64(leaf.key) };
}
const erase = (material) => { material.certificateBytes.fill(0); material.caBytes.fill(0); material.keyBytes.fill(0); };
const inspect = (candidate = environment, clock = now) => inspectDatabaseBackupCertificateMaterial(candidate, validateDatabaseBackupRolesAnywhereConfiguration(candidate), clock);
before(() => {
  temporary = mkdtempSync(join(tmpdir(), "applypack-database-backup-identity-test-"));
  ({ certificate: ca, key: caKey } = makeCa("ca")); otherCa = makeCa("other");
  writeFileSync(join(temporary, "leaf.ext"), "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n");
  writer = makeLeaf("database", "applypack-production-database-backup-writer");
  unrelated = ["recovery-writer", "recovery-retention", "railway-caller", "recovery-operator"].map((name) => makeLeaf(name, `applypack-production-${name}`));
  longLived = makeLeaf("extended", "applypack-production-database-backup-writer", "31");
  environment = { ...configuration, [`${prefix}CERTIFICATE_SHA256`]: certificateHash(writer.certificate),
    [`${prefix}CA_CERTIFICATE_SHA256`]: certificateHash(ca), [`${prefix}CERTIFICATE_PEM_BASE64`]: base64(writer.certificate),
    [`${prefix}CA_CERTIFICATE_PEM_BASE64`]: base64(ca), [`${prefix}PRIVATE_KEY_PEM_BASE64`]: base64(writer.key) };
  now = Date.parse(new X509Certificate(writer.certificate).validFrom) + 60000;
});
after(() => {
  if (temporary && dirname(resolve(temporary)) === resolve(tmpdir())
    && temporary.startsWith(join(tmpdir(), "applypack-database-backup-identity-test-"))) rmSync(temporary, { recursive: true, force: true });
  for (const leaf of [writer, ...(unrelated || []), longLived, otherCa]) { leaf?.certificate.fill(0); leaf?.key.fill(0); }
  ca?.fill(0); caKey?.fill(0);
});

test("only fixed production database writer identity is accepted", () => {
  assert.equal(validateDatabaseBackupRolesAnywhereConfiguration(configuration).roleArn, DATABASE_BACKUP_WORKLOAD.roleArn);
  assert.equal(Object.isFrozen(validateDatabaseBackupRolesAnywhereConfiguration(configuration)), true);
  assert.doesNotThrow(() => validateDatabaseBackupRolesAnywhereConfiguration({ ...configuration,
    APP_AWS_RA_HELPER_PATH: DATABASE_BACKUP_WORKLOAD.helperPath, APP_DATABASE_BACKUP_DB_PASSWORD: "synthetic-private-input" }));
  for (const key of Object.keys(configuration)) assert.throws(() => validateDatabaseBackupRolesAnywhereConfiguration({ ...configuration, [key]: undefined }));
  for (const [name, value] of Object.entries({ APP_DEPLOYMENT_ENV: "staging", APP_DATABASE_BACKUP_AWS_RA_DEPLOYMENT_ENV: "staging",
    APP_AWS_ACCOUNT_ID: "123456789012", AWS_REGION: "us-west-2", APP_DATABASE_BACKUP_AWS_RA_ROLE_ARN: DATABASE_BACKUP_WORKLOAD.roleArn.replace("database-backup", "recovery"),
    APP_DATABASE_BACKUP_AWS_RA_PROFILE_ARN: configuration.APP_DATABASE_BACKUP_AWS_RA_PROFILE_ARN.replace("838445019912", "123456789012"),
    APP_DATABASE_BACKUP_AWS_RA_TRUST_ANCHOR_ARN: configuration.APP_DATABASE_BACKUP_AWS_RA_TRUST_ANCHOR_ARN.replace("us-east-1", "us-west-2"),
    APP_DATABASE_BACKUP_AWS_RA_HELPER_PATH: "/tmp/helper", APP_DATABASE_BACKUP_AWS_RA_CERTIFICATE_SHA256: "A".repeat(64) })) {
    assert.throws(() => validateDatabaseBackupRolesAnywhereConfiguration({ ...configuration, [name]: value }));
  }
});

test("default credentials and transport overrides are rejected case-insensitively", () => {
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_PROFILE", "AWS_DEFAULT_PROFILE",
    "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ROLE_ARN", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_STS", "AWS_ENDPOINT_URL_S3", "AWS_CA_BUNDLE",
    "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS"]) for (const spelling of [name, name.toLowerCase()]) {
    assert.throws(() => validateDatabaseBackupRolesAnywhereConfiguration({ ...configuration, [spelling]: "private-value" }), /alternate_credentials_or_transport/u);
  }
});

test("official image metadata does not grant any connection capability", () => {
  assert.doesNotThrow(() => validateDatabaseBackupRolesAnywhereConfiguration({ ...configuration,
    PG_MAJOR: "17", PG_VERSION: "17.11-1.pgdg13+1", PGDATA: "/var/lib/postgresql/data" }));
  for (const name of ["PGDATA_OTHER", "pgdata", "PGHOSTADDR", "PGSSLROOTCERT"]) {
    assert.throws(() => validateDatabaseBackupRolesAnywhereConfiguration({ ...configuration, [name]: "synthetic" }));
  }
});

test("file, web, retention, application and ambient database capabilities cannot accompany exporter", () => {
  for (const name of ["APP_BACKUP_AWS_RA_PRIVATE_KEY_PEM_BASE64", "APP_RETENTION_AWS_RA_ROLE_ARN", "APP_AWS_RA_CERTIFICATE_PEM_BASE64",
    "APP_RECOVERY_READER_SECRET", "APP_RECOVERY_RECEIPT_SECRET", "CRON_SECRET", "PGPASSWORD", "PGPASSFILE", "PGHOST", "PGPORT", "PGOPTIONS",
    "PGSERVICE", "PGSERVICEFILE", "DATABASE_URL", "DIRECT_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ACCESS_TOKEN",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) for (const spelling of [name, name.toLowerCase()]) {
    assert.throws(() => validateDatabaseBackupRolesAnywhereConfiguration({ ...configuration, [spelling]: "private-value" }));
  }
  assert.throws(() => validateDatabaseBackupRolesAnywhereConfiguration({ ...configuration, APP_AWS_RA_HELPER_PATH: "/tmp/helper" }));
});

test("real synthetic database leaf works and all other workload leaves fail", () => {
  const material = inspect(); assert.ok(material.keyBytes.equals(writer.key)); assert.equal(material.rotationDue, false); erase(material);
  for (const leaf of [...unrelated, longLived, { certificate: ca, key: caKey }]) assert.throws(() => inspect(withLeaf(leaf)), /certificate_binding_invalid/u);
  for (const extra of [{ [`${prefix}PRIVATE_KEY_PEM_BASE64`]: base64(unrelated[0].key) },
    { [`${prefix}CERTIFICATE_SHA256`]: "a".repeat(64) }, { [`${prefix}CA_CERTIFICATE_SHA256`]: "b".repeat(64) },
    { [`${prefix}CA_CERTIFICATE_PEM_BASE64`]: base64(otherCa.certificate), [`${prefix}CA_CERTIFICATE_SHA256`]: certificateHash(otherCa.certificate) },
    { [`${prefix}CA_CERTIFICATE_PEM_BASE64`]: base64(writer.certificate), [`${prefix}CA_CERTIFICATE_SHA256`]: certificateHash(writer.certificate) }]) {
    assert.throws(() => inspect({ ...environment, ...extra }), /^Error: aws_database_backup_roles_anywhere_certificate_binding_invalid$/u);
  }
});

test("malformed or bundled private material yields only a fixed error code", () => {
  for (const field of ["CERTIFICATE_PEM_BASE64", "CA_CERTIFICATE_PEM_BASE64", "PRIVATE_KEY_PEM_BASE64"]) {
    for (const value of [undefined, "", "%%%", "Zg", "A".repeat(32769), base64("private value never logged")]) {
      assert.throws(() => inspect({ ...environment, [`${prefix}${field}`]: value }), /^Error: aws_database_backup_roles_anywhere_certificate_binding_invalid$/u);
    }
  }
  for (const mixed of [Buffer.concat([writer.certificate, ca]), Buffer.concat([writer.certificate, writer.key]), Buffer.concat([writer.certificate, Buffer.from("extra")])]) {
    assert.throws(() => inspect({ ...environment, [`${prefix}CERTIFICATE_PEM_BASE64`]: base64(mixed) }), /certificate_binding_invalid/u);
  }
  assert.throws(() => inspect({ ...environment, [`${prefix}PRIVATE_KEY_PEM_BASE64`]: base64(Buffer.concat([writer.key, caKey])) }), /certificate_binding_invalid/u);
});

test("validity window and expiry margin are bounded and status never claims provider proof", () => {
  const leaf = new X509Certificate(writer.certificate); const expiry = Date.parse(leaf.validTo);
  for (const clock of [NaN, Date.parse(leaf.validFrom) - 1, expiry - 65 * 60000, expiry]) assert.throws(() => inspect(environment, clock));
  const material = inspect(environment, expiry - 7 * 86400000); assert.equal(material.rotationDue, true); erase(material);
  assert.throws(() => inspectDatabaseBackupCertificateMaterial(environment, { ...validateDatabaseBackupRolesAnywhereConfiguration(environment), roleArn: "changed" }, now));
  const status = databaseBackupRolesAnywhereCertificateStatus(environment);
  assert.equal(status.providerVerified, false); assert.equal(status.roleArn, DATABASE_BACKUP_WORKLOAD.roleArn);
  assert.deepEqual(Object.keys(status).sort(), ["account", "certificateSha256", "deployment", "expiresAt", "providerVerified", "roleArn", "rotationDue"].sort());
});

test("STS identity must match exact account and database assumed role", () => {
  const identity = { Account: DATABASE_BACKUP_WORKLOAD.account, Arn: "arn:aws:sts::838445019912:assumed-role/applypack-production-database-backup-writer/session1" };
  assertDatabaseBackupCallerIdentity(identity);
  for (const invalid of [null, {}, { ...identity, Account: "123456789012" }, { ...identity, Arn: 123 },
    ...["recovery-writer", "railway-caller", "recovery-retention"].map((role) => ({ ...identity, Arn: identity.Arn.replace("database-backup-writer", role) })),
    { ...identity, Arn: `${identity.Arn}/extra` }, { ...identity, Arn: identity.Arn.replace("session1", "") },
    { ...identity, Arn: identity.Arn.replace("session1", "a".repeat(65)) }]) assert.throws(() => assertDatabaseBackupCallerIdentity(invalid), /caller_identity_mismatch/u);
});

test("missing material and changed configuration fail without default-chain or network fallback", async () => {
  const provider = awsDatabaseBackupWorkloadCredentials(configuration);
  await assert.rejects(provider(), /^Error: aws_roles_anywhere_refresh_failed$/u);
  const mutable = { ...environment }; const fixed = awsDatabaseBackupWorkloadCredentials(mutable);
  mutable.APP_DATABASE_BACKUP_AWS_RA_PROFILE_ARN = "arn:aws:rolesanywhere:us-east-1:838445019912:profile/cccccccc-cccc-cccc-cccc-cccccccccccc";
  await assert.rejects(fixed(), /identity_configuration_changed/u);
  mutable.APP_DATABASE_BACKUP_AWS_RA_PROFILE_ARN = configuration.APP_DATABASE_BACKUP_AWS_RA_PROFILE_ARN;
  mutable.AWS_ACCESS_KEY_ID = "synthetic";
  await assert.rejects(fixed(), /alternate_credentials_or_transport/u);
});
