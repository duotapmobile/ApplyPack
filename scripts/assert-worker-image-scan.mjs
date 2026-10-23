import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const normalizeName = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

export function assertWorkerImageScan(report, installedPython) {
  assert.equal(report?.SchemaVersion, 2, "expected supported scanner report schema");
  assert.equal(report?.Metadata?.OS?.Family, "ubuntu", "expected detected Ubuntu worker runtime");
  assert.equal(report.Metadata.OS.Name, "26.04", "expected detected Ubuntu 26.04 worker runtime");
  assert.ok(Array.isArray(report.Results), "scan results missing");
  assert.ok(report.Results.every((result) => result && typeof result === "object"
    && (result.Vulnerabilities === undefined || Array.isArray(result.Vulnerabilities))), "malformed vulnerability results");
  const os = report.Results.find((result) => result.Class === "os-pkgs" && result.Type === "ubuntu");
  const python = report.Results.filter((result) => result.Class === "lang-pkgs" && result.Type === "python-pkg");
  assert.ok(os && Array.isArray(os.Packages) && os.Packages.length > 0, "OS inventory required");
  for (const name of ["libc6", "libreoffice-writer-nogui", "libreoffice-core-nogui", "poppler-utils", "fontconfig", "python3"]) {
    assert.ok(os.Packages.some((pkg) => pkg.Name === name), `worker OS package coverage missing: ${name}`);
  }
  assert.ok(python.length > 0 && python.every((result) => Array.isArray(result.Packages) && result.Packages.length > 0),
    "Python inventory required");
  assert.ok(Array.isArray(installedPython) && installedPython.length > 0
    && installedPython.every((pkg) => typeof pkg?.name === "string" && pkg.name.length > 0
      && typeof pkg.version === "string" && pkg.version.length > 0), "installed Python inventory required");
  const installedNames = installedPython.map((pkg) => normalizeName(pkg.name));
  assert.equal(new Set(installedNames).size, installedNames.length, "duplicate installed Python inventory");
  for (const name of ["awslambdaric", "boto3", "botocore", "urllib3"]) {
    assert.ok(installedNames.includes(name), `required worker Python dependency missing: ${name}`);
  }
  const packages = python.flatMap((result) => result.Packages);
  for (const installed of installedPython) {
    assert.ok(packages.some((pkg) => typeof pkg.Name === "string"
      && normalizeName(pkg.Name) === normalizeName(installed.name) && pkg.Version === installed.version
      && /^\/?opt\/python\//.test(pkg.FilePath || "")),
    `installed worker Python package coverage missing: ${installed.name}`);
  }
  const findings = report.Results.flatMap((result) => result.Vulnerabilities || []);
  assert.ok(findings.every((finding) => finding && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(finding.Severity)),
    "unclassified vulnerability findings cannot pass");
  assert.equal(findings.filter((finding) => ["HIGH", "CRITICAL"].includes(finding.Severity)).length, 0,
    "all High and Critical worker findings must be remediated without suppression");
  return { status: "PASS", os: report.Metadata.OS, osPackages: os.Packages.length,
    pythonPackages: packages.length, installedPythonPackages: installedPython.length, highCriticalFindings: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) {
    throw new Error("usage: node scripts/assert-worker-image-scan.mjs <trivy-report.json> <installed-python.json>");
  }
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  console.log(JSON.stringify(assertWorkerImageScan(readJson(process.argv[2]), readJson(process.argv[3]))));
}
