import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { SIGNING_HELPER } from "./lib/aws-roles-anywhere.mjs";

// Runs only inside the disposable root helper-install build stage, with networking disabled.
if (process.platform !== "linux" || process.arch !== "x64" || process.getuid() !== 0) {
  throw new Error("installer_contract_requires_disposable_linux_x64_root_build_stage");
}
const input = "/opt/applypack-helper-input/aws_signing_helper";
const sidecar = `${input}.original`;
const output = "/usr/local/bin/aws_signing_helper";
assert.equal(existsSync(output), false);
assert.equal(existsSync(sidecar), false);
const original = readFileSync(input);
assert.equal(createHash("sha256").update(original).digest("hex"), SIGNING_HELPER.sha256);
const install = (destination = output) => spawnSync(process.execPath,
  ["scripts/install-aws-signing-helper.mjs", destination], {
    encoding: "utf8", timeout: 10000, maxBuffer: 65536, shell: false, env: { PATH: process.env.PATH },
  });
const denied = (result, message) => {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
  assert.equal(existsSync(output), false);
};
denied(install("/tmp/not-the-approved-helper"), /root_and_fixed_output/);
try {
  chmodSync(input, 0o777);
  denied(install(), /input_invalid/);
} finally { chmodSync(input, 0o755); }
renameSync(input, sidecar);
try {
  symlinkSync(sidecar, input);
  denied(install(), /input_invalid/);
} finally {
  if (existsSync(input)) unlinkSync(input);
  renameSync(sidecar, input);
}
try {
  const altered = Buffer.from(original); altered[altered.length - 1] ^= 1;
  writeFileSync(input, altered);
  denied(install(), /checksum_mismatch/);
} finally { writeFileSync(input, original); }
const installed = install();
assert.equal(installed.error, undefined); assert.equal(installed.status, 0, installed.stderr);
assert.equal(JSON.parse(installed.stdout).networkUsed, false);
assert.equal(createHash("sha256").update(readFileSync(output)).digest("hex"), SIGNING_HELPER.sha256);
const metadata = lstatSync(output);
assert.equal(metadata.uid, 0); assert.equal(metadata.gid, 0); assert.equal(metadata.mode & 0o777, 0o755);
const duplicate = install();
assert.equal(duplicate.error, undefined); assert.notEqual(duplicate.status, 0); assert.match(duplicate.stderr, /EEXIST/);
assert.equal(createHash("sha256").update(readFileSync(input)).digest("hex"), SIGNING_HELPER.sha256);
console.log(JSON.stringify({ status: "PASS", scope: "disposable-local-helper-install-contract", checks: 6,
  alteredBytesDenied: true, symlinkDenied: true, writableInputDenied: true, alternateOutputDenied: true,
  exactArtifactInstalled: true, overwriteDenied: true, sha256: SIGNING_HELPER.sha256, providerCalls: 0 }));
