import assert from "node:assert/strict";
import test from "node:test";
import { assertLaunchImageScan } from "./assert-launch-image-scan.mjs";

function report() {
  return { Metadata: { OS: { Family: "debian", Name: "13.7" } }, Results: [
    { Class: "os-pkgs", Type: "debian", Packages: [{ Name: "libc6" }] },
    { Class: "lang-pkgs", Type: "node-pkg", Packages: [{ FilePath: "app/node_modules/next/package.json" }] },
    { Class: "lang-pkgs", Type: "gobinary", Target: "usr/local/bin/aws_signing_helper", Packages: [{ Name: "stdlib" }] },
  ] };
}
test("accepts zero findings only with OS, application and helper inventories", () => {
  assert.equal(assertLaunchImageScan(report()).status, "PASS");
});
for (const index of [0, 1, 2]) {
  test(`rejects absent or empty required component ${index}`, () => {
    const missing = report(); missing.Results.splice(index, 1);
    assert.throws(() => assertLaunchImageScan(missing), /inventories/);
    const empty = report(); empty.Results[index].Packages = [];
    assert.throws(() => assertLaunchImageScan(empty), /inventories/);
  });
}
test("rejects package-manager-only Node coverage and a different helper path", () => {
  const npmOnly = report(); npmOnly.Results[1].Packages[0].FilePath = "usr/local/lib/node_modules/npm/package.json";
  assert.throws(() => assertLaunchImageScan(npmOnly), /application runtime/);
  const wrongHelper = report(); wrongHelper.Results[2].Target = "other/helper";
  assert.throws(() => assertLaunchImageScan(wrongHelper), /inventories/);
});
test("rejects both High and Critical findings, even outside a required component", () => {
  for (const Severity of ["HIGH", "CRITICAL"]) {
    const findings = report(); findings.Results.push({ Vulnerabilities: [{ Severity }] });
    assert.throws(() => assertLaunchImageScan(findings), /must be remediated/);
  }
});
test("rejects missing or unexpected OS metadata", () => {
  const missing = report(); delete missing.Metadata.OS;
  assert.throws(() => assertLaunchImageScan(missing), /Debian runtime/);
  const oldBase = report(); oldBase.Metadata.OS.Name = "12.15";
  assert.throws(() => assertLaunchImageScan(oldBase), /Debian 13/);
});
