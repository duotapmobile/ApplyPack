import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkerImageScan } from "./assert-worker-image-scan.mjs";

const inventory = () => ["awslambdaric", "boto3", "botocore", "urllib3", "python-dateutil"]
  .map((name) => ({ name, version: "1.0.0" }));
function report() {
  return { SchemaVersion: 2, Metadata: { OS: { Family: "ubuntu", Name: "26.04" } }, Results: [
    { Class: "os-pkgs", Type: "ubuntu", Packages: ["libc6", "libreoffice-writer-nogui", "libreoffice-core-nogui", "poppler-utils", "fontconfig", "python3"]
      .map((Name) => ({ Name })) },
    { Class: "lang-pkgs", Type: "python-pkg", Packages: inventory().map(({ name, version }) =>
      ({ Name: name, Version: version, FilePath: `opt/python/${name}-${version}.dist-info/METADATA` })) },
  ] };
}

test("requires detected OS and every installed Python dependency at its image path/version", () => {
  assert.deepEqual(assertWorkerImageScan(report(), inventory()), { status: "PASS", os: { Family: "ubuntu", Name: "26.04" },
    osPackages: 6, pythonPackages: 5, installedPythonPackages: 5, highCriticalFindings: 0 });
});
test("rejects missing or empty inventories and required renderer tools", () => {
  for (const index of [0, 1]) {
    const missing = report(); missing.Results.splice(index, 1);
    assert.throws(() => assertWorkerImageScan(missing, inventory()), /inventory required/);
    const empty = report(); empty.Results[index].Packages = [];
    assert.throws(() => assertWorkerImageScan(empty, inventory()), /inventory required/);
  }
  const missingRenderer = report(); missingRenderer.Results[0].Packages.splice(1, 1);
  assert.throws(() => assertWorkerImageScan(missingRenderer, inventory()), /libreoffice-writer/);
});
test("rejects incomplete dependency coverage, wrong versions and unrelated Python installations", () => {
  for (const mutation of [
    (packages) => packages.pop(),
    (packages) => { packages[4].Version = "2.0.0"; },
    (packages) => { packages[4].FilePath = "usr/lib/python3/python-dateutil/METADATA"; },
  ]) {
    const value = report(); mutation(value.Results[1].Packages);
    assert.throws(() => assertWorkerImageScan(value, inventory()), /package coverage missing/);
  }
});
test("normalizes Python distribution names but never ignores absent runtime dependencies", () => {
  const value = report(); value.Results[1].Packages[4].Name = "Python_DateUtil";
  assert.equal(assertWorkerImageScan(value, inventory()).status, "PASS");
  assert.throws(() => assertWorkerImageScan(report(), inventory().filter((pkg) => pkg.name !== "boto3")), /dependency missing/);
  assert.throws(() => assertWorkerImageScan(report(), []), /installed Python inventory required/);
  assert.throws(() => assertWorkerImageScan(report(), [...inventory(), inventory()[0]]), /duplicate/);
});
test("rejects High and Critical findings anywhere in the worker, including additional components", () => {
  for (const Severity of ["HIGH", "CRITICAL"]) {
    const value = report(); value.Results.push({ Vulnerabilities: [{ Severity }] });
    assert.throws(() => assertWorkerImageScan(value, inventory()), /must be remediated/);
  }
});
test("rejects malformed or unclassified vulnerability results", () => {
  for (const Vulnerabilities of [{ Severity: "HIGH" }, [null], [{ Severity: "UNKNOWN" }], [{}]]) {
    const value = report(); value.Results.push({ Vulnerabilities });
    assert.throws(() => assertWorkerImageScan(value, inventory()), /malformed|unclassified/);
  }
});
test("rejects unsupported scanner or operating system metadata", () => {
  for (const mutation of [
    (value) => { delete value.Metadata.OS; },
    (value) => { value.Metadata.OS.Family = "debian"; value.Metadata.OS.Name = "13.7"; },
    (value) => { value.Metadata.OS.Name = "24.04"; },
    (value) => { delete value.SchemaVersion; },
  ]) {
    const value = report(); mutation(value);
    assert.throws(() => assertWorkerImageScan(value, inventory()), /expected/);
  }
});
