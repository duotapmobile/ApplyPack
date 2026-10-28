import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function assertLaunchImageScan(report) {
  assert.equal(report?.Metadata?.OS?.Family, "debian", "expected detected Debian runtime");
  assert.match(report.Metadata.OS.Name, /^13(?:\.|$)/, "expected detected Debian 13 runtime");
  assert.ok(Array.isArray(report.Results), "scan results missing");
  const required = [
    report.Results.find((result) => result.Class === "os-pkgs" && result.Type === "debian"),
    report.Results.find((result) => result.Class === "lang-pkgs" && result.Type === "node-pkg"),
    report.Results.find((result) => result.Class === "lang-pkgs" && result.Type === "gobinary"
      && result.Target === "usr/local/bin/aws_signing_helper"),
  ];
  for (const component of required) {
    assert.ok(component && Array.isArray(component.Packages) && component.Packages.length > 0,
      "OS, application packages and helper package inventories are all required");
  }
  assert.ok(required[1].Packages.some((pkg) => pkg.FilePath?.startsWith("app/node_modules/")),
    "application runtime packages must be detected");
  const findings = report.Results.flatMap((result) => result.Vulnerabilities || []);
  assert.equal(findings.filter((finding) => ["HIGH", "CRITICAL"].includes(finding.Severity)).length, 0,
    "all High and Critical findings must be remediated without suppression");
  return { status: "PASS", os: report.Metadata.OS, packages: required.map(({ Type, Packages }) =>
    ({ type: Type, count: Packages.length })), highCriticalFindings: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("usage: node scripts/assert-launch-image-scan.mjs <trivy-report.json>");
  console.log(JSON.stringify(assertLaunchImageScan(JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, "")))));
}
