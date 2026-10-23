import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SIGNING_HELPER, assertTrustedHelperMetadata } from "./lib/aws-roles-anywhere.mjs";

const path = "/usr/local/bin/aws_signing_helper";
if (process.platform !== "linux" || process.arch !== "x64" || process.getuid() === 0) throw new Error("launch_runtime_identity_invalid");
if (process.version !== "v22.23.4" || existsSync("/bin/sh") || existsSync("/usr/local/lib/node_modules/npm")
  || !readFileSync("/etc/os-release", "utf8").includes("debian")
  || readdirSync("/var/lib/dpkg/status.d").length === 0
  || !readFileSync("/etc/ssl/certs/ca-certificates.crt", "utf8").includes("BEGIN CERTIFICATE")
  || readdirSync("/usr/share/applypack/signing-helper/provenance").length === 0
  || readdirSync("/usr/share/applypack/signing-helper/licenses").length === 0) {
  throw new Error("launch_minimal_runtime_or_provenance_invalid");
}
const entries = [lstatSync(path)];
for (let parent = dirname(path);; parent = dirname(parent)) {
  const info = lstatSync(parent);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("launch_helper_ancestor_invalid");
  entries.push(info); if (parent === "/") break;
}
assertTrustedHelperMetadata(entries, process.getuid());
if (entries[0].isSymbolicLink() || createHash("sha256").update(readFileSync(path)).digest("hex") !== SIGNING_HELPER.sha256
  || statfsSync("/dev/shm").type !== 0x01021994) throw new Error("launch_helper_or_tmpfs_invalid");
execFileSync(path, ["--help"], { encoding: "utf8", timeout: 5000, maxBuffer: 32768, stdio: ["ignore", "pipe", "pipe"],
  env: { PATH: "/usr/bin:/bin" } });
const helperVersion = execFileSync(path, ["version"], { encoding: "utf8", timeout: 5000, maxBuffer: 32768,
  stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } }).trim();
if (!helperVersion.includes(SIGNING_HELPER.version)) throw new Error("launch_helper_version_invalid");
const temporary = mkdtempSync("/dev/shm/applypack-runtime-proof-");
try { writeFileSync(join(temporary, "probe"), "synthetic-no-secret", { mode: 0o600, flag: "wx" }); }
finally {
  if (dirname(temporary) !== "/dev/shm" || !temporary.startsWith("/dev/shm/applypack-runtime-proof-")) throw new Error("launch_cleanup_path_invalid");
  rmSync(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify({ schemaVersion: 1, scope: "local-credential-runtime-package", platform: process.platform,
  architecture: process.arch, nodeVersion: process.version, uid: process.getuid(), helperSha256: SIGNING_HELPER.sha256,
  helperExecutable: true, helperAndParentsRootOwned: true, ephemeralStorage: "tmpfs", probeCleanup: true,
  shellAbsent: true, packageManagerAbsent: true, osPackageMetadataPreserved: true, publicCaBundlePresent: true,
  helperProvenanceAndLicensesPresent: true, helperVersion,
  providerCalls: 0, credentialsRead: false, applicationBuildVerified: false }));
