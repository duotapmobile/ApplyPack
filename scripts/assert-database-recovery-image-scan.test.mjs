import assert from "node:assert/strict";
import test from "node:test";
import { assertDatabaseRecoveryImageScan } from "./assert-database-recovery-image-scan.mjs";

const report = () => ({ Metadata: { OS: { Family: "debian", Name: "13.7" } }, Results: [
  { Class: "os-pkgs", Type: "debian", Packages: [{ Name: "postgresql-client-17", Version: "17.11", SrcName: "postgresql-17" },
    { Name: "libpq5", Version: "17.11", SrcName: "postgresql-17" }, { Name: "libc6" }, { Name: "libssl3t64" }, { Name: "zlib1g" }] },
  { Class: "lang-pkgs", Type: "node-pkg", Packages: [{ FilePath: "app/node_modules/zod/package.json" }] },
  { Class: "lang-pkgs", Type: "gobinary", Target: "usr/local/bin/aws_signing_helper", Packages: [{ Name: "stdlib" }] },
] });
test("database image requires OS, client, Node and helper coverage with no high or critical findings", () => {
  assert.equal(assertDatabaseRecoveryImageScan(report()).status, "PASS");
  for (let index = 0; index < 3; index++) {
    const missing = report(); missing.Results.splice(index, 1);
    assert.throws(() => assertDatabaseRecoveryImageScan(missing));
  }
  const wrongClient = report(); wrongClient.Results[0].Packages[0].Version = "17.6-1";
  assert.throws(() => assertDatabaseRecoveryImageScan(wrongClient));
  for (const Severity of ["HIGH", "CRITICAL"]) {
    const vulnerable = report(); vulnerable.Results.push({ Vulnerabilities: [{ Severity }] });
    assert.throws(() => assertDatabaseRecoveryImageScan(vulnerable));
  }
});

for (const name of ["libpq5", "libc6", "libssl3t64", "zlib1g"]) test("requires shared-library inventory for " + name, () => {
  const missing = report(); missing.Results[0].Packages = missing.Results[0].Packages.filter((entry) => entry.Name !== name);
  assert.throws(() => assertDatabaseRecoveryImageScan(missing));
});
