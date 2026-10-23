import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { validateRolesAnywhereConfiguration, parseTemporaryCredentials, assertCallerIdentity,
  createRefreshingProvider, inspectCertificateMaterial, assertTrustedHelperMetadata, assertSinglePem, SIGNING_HELPER } from "./lib/aws-roles-anywhere.mjs";
import { prepareRolesAnywhere } from "./prepare-aws-roles-anywhere.mjs";

const environment = { APP_DEPLOYMENT_ENV: "staging", APP_AWS_RA_DEPLOYMENT_ENV: "staging",
  APP_AWS_ACCOUNT_ID: "838445019912", AWS_REGION: "us-east-1",
  APP_AWS_RA_ROLE_ARN: "arn:aws:iam::838445019912:role/applypack/staging/applypack-staging-railway-caller",
  APP_AWS_RA_PROFILE_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:profile/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  APP_AWS_RA_TRUST_ANCHOR_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:trust-anchor/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  APP_AWS_RA_HELPER_PATH: "/usr/local/bin/aws_signing_helper",
  APP_AWS_RA_CERTIFICATE_SHA256: "a".repeat(64), APP_AWS_RA_CA_CERTIFICATE_SHA256: "b".repeat(64) };
const now = Date.parse("2026-10-22T00:00:00Z");
const output = (expiration = now + 3600000) => JSON.stringify({ Version: 1,
  AccessKeyId: `ASIA${"A".repeat(16)}`, SecretAccessKey: "x".repeat(40), SessionToken: "fixture".repeat(4),
  Expiration: new Date(expiration).toISOString() });

test("exact environment/account/role/profile/trust identities fail closed", () => {
  assert.equal(validateRolesAnywhereConfiguration(environment).deployment, "staging");
  for (const [key, value] of Object.entries({ APP_DEPLOYMENT_ENV: "preview", APP_AWS_RA_DEPLOYMENT_ENV: "production",
    APP_AWS_ACCOUNT_ID: "123456789012", AWS_REGION: "us-west-2", APP_AWS_RA_ROLE_ARN: "arn:aws:iam::838445019912:role/admin",
    APP_AWS_RA_PROFILE_ARN: "invalid", APP_AWS_RA_TRUST_ANCHOR_ARN: "invalid", APP_AWS_RA_HELPER_PATH: "relative",
    APP_AWS_RA_CERTIFICATE_SHA256: "", APP_AWS_RA_CA_CERTIFICATE_SHA256: "" })) {
    assert.throws(() => validateRolesAnywhereConfiguration({ ...environment, [key]: value }));
  }
});
test("static and alternate credentials and endpoint/TLS overrides cannot provide a fallback", () => {
  for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE",
    "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_STS", "AWS_CA_BUNDLE", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
    assert.throws(() => validateRolesAnywhereConfiguration({ ...environment, [key]: "fixture" }), /alternate/);
  }
});
test("credentials must be temporary, current, complete and bounded to one hour", () => {
  assert.equal(parseTemporaryCredentials(output(), now).expiration.getTime(), now + 3600000);
  for (const value of ["invalid", "{}", output(now + 300000), output(now + 3600001), output().replace("ASIA", "AKIA")]) {
    assert.throws(() => parseTemporaryCredentials(value, now));
  }
});
test("runtime identity must be the exact environment caller role", () => {
  const configuration = validateRolesAnywhereConfiguration(environment);
  const identity = { Account: environment.APP_AWS_ACCOUNT_ID, Arn: "arn:aws:sts::838445019912:assumed-role/applypack-staging-railway-caller/session1" };
  assertCallerIdentity(identity, configuration);
  for (const invalid of [{ ...identity, Account: "123456789012" }, { ...identity, Arn: identity.Arn.replace("staging", "production") },
    { ...identity, Arn: identity.Arn.replace("railway-caller", "document-worker-execution") }, { ...identity, Arn: identity.Arn + "/other" }]) {
    assert.throws(() => assertCallerIdentity(invalid, configuration), /identity_mismatch/);
  }
});
test("concurrent callers share one refresh and refresh before expiry", async () => {
  let time = now; let calls = 0;
  const provider = createRefreshingProvider(async () => { calls++; return parseTemporaryCredentials(output(time + 3600000), time); }, () => time);
  await Promise.all([provider(), provider(), provider()]); assert.equal(calls, 1);
  time += 55 * 60000; await provider(); assert.equal(calls, 2);
});
test("helper failure/revocation at refresh never returns the previous credentials", async () => {
  let time = now; let revoke = false;
  const provider = createRefreshingProvider(async () => {
    if (revoke) throw new Error("sensitive-provider-error-must-not-escape");
    return parseTemporaryCredentials(output(), now);
  }, () => time);
  await provider(); revoke = true; time += 56 * 60000;
  await assert.rejects(provider(), /^Error: aws_roles_anywhere_refresh_failed$/);
  await assert.rejects(provider(), /^Error: aws_roles_anywhere_refresh_failed$/);
});
test("missing/malformed sealed leaf material is rejected without invoking a helper", () => {
  assert.throws(() => inspectCertificateMaterial(environment, validateRolesAnywhereConfiguration(environment)), /certificate_binding_invalid/);
});
test("sealed fields contain exactly one allowed PEM object and never a bundled CA private key", () => {
  const certificate = "-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n";
  const key = "-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----\n";
  assertSinglePem(Buffer.from(certificate), "certificate"); assertSinglePem(Buffer.from(key), "privateKey");
  for (const invalid of [certificate + certificate, certificate + key, key + certificate, certificate + "trailing"]) {
    assert.throws(() => assertSinglePem(Buffer.from(invalid), "certificate"), /pem_envelope_invalid/);
  }
  for (const invalid of [key + key, key + certificate, certificate, key.replace("END PRIVATE KEY", "END RSA PRIVATE KEY")]) {
    assert.throws(() => assertSinglePem(Buffer.from(invalid), "privateKey"), /pem_envelope_invalid/);
  }
});
test("runtime cannot replace the root-owned helper or any ancestor", () => {
  assertTrustedHelperMetadata([{ uid: 0, mode: 0o100755 }, { uid: 0, mode: 0o40755 }], 1000);
  for (const [entries, uid] of [[[{ uid: 1000, mode: 0o100755 }], 1000],
    [[{ uid: 0, mode: 0o100755 }, { uid: 0, mode: 0o40777 }], 1000],
    [[{ uid: 0, mode: 0o100755 }], 0]]) assert.throws(() => assertTrustedHelperMetadata(entries, uid));
});
test("review artifact generation rejects unknown targets and noncertificate material without AWS calls", () => {
  assert.throws(() => prepareRolesAnywhere({}, "invalid"), /identity_invalid/);
  const manifest = { deploymentEnvironment: "staging", accountId: "838445019912", region: "us-east-1",
    workerVersionArn: "arn:aws:lambda:us-east-1:838445019912:function:applypack-staging-document-worker:1",
    kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", kmsKeyVersion: "v1",
    temporaryBucket: "applypack-838445019912-staging-document-worker-temp", temporaryPrefix: "ephemeral/" };
  assert.throws(() => prepareRolesAnywhere(manifest, "invalid"), /public_ca_invalid/);
  assert.throws(() => prepareRolesAnywhere({ ...manifest, workerVersionArn: manifest.workerVersionArn.replace("staging", "production") }, "invalid"), /identity_invalid/);
});
test("prepared template disables trust by default and separates roles", () => {
  const template = JSON.parse(readFileSync(new URL("../infra/aws/roles-anywhere/template.json", import.meta.url), "utf8"));
  assert.equal(template.Parameters.EnableCaller.Default, "false");
  assert.equal(template.Resources.CallerRole.Properties.MaxSessionDuration, 3600);
  assert.equal(template.Resources.CallerProfile.Properties.DurationSeconds, 3600);
  assert.deepEqual(template.Resources.CallerProfile.Properties.RoleArns, [{ "Fn::GetAtt": ["CallerRole", "Arn"] }]);
  const trust = template.Resources.CallerRole.Properties.AssumeRolePolicyDocument.Statement[0];
  assert.equal(trust.Principal.Service, "rolesanywhere.amazonaws.com");
  assert.deepEqual(trust.Condition.ArnEquals["aws:SourceArn"], { "Fn::GetAtt": ["CallerTrustAnchor", "TrustAnchorArn"] });
  assert.equal(template.Resources.CallerRole.Properties.Policies, undefined);
  assert.equal(SIGNING_HELPER.version, "1.8.5+applypack.1");
  assert.equal(SIGNING_HELPER.upstreamVersion, "1.8.5");
  assert.equal(SIGNING_HELPER.sourceCommit, "08f7df47e6da0b58c0e5960c41f5d3601042b1d2");
  assert.equal("url" in SIGNING_HELPER, false);
  assert.match(SIGNING_HELPER.sha256, /^[a-f0-9]{64}$/);
});
