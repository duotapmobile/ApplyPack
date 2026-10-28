import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const base = resolve("docs/evidence/launch-execution-2026-10-22/recovery-ci-continuation/image-attempt-02");
const local = resolve("evidence/launch-recovery-ci/image-refresh-02");
const host = "npipe:////./pipe/dockerDesktopLinuxEngine";
const tag = "applypack-launch-web:recovery-ci-20261023-02";
const scannerImage = "public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86";
const scanRoot = resolve("evidence/launch-image-scanner");
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const write = (name, value) => writeFileSync(resolve(base, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
function capture(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).trim();
}
function run(command, args, logName, timeout = 1200000) {
  console.log(`${new Date().toISOString()} START ${logName}`);
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout,
    maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(resolve(base, logName), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  console.log(`${new Date().toISOString()} END ${logName} exit=${result.status}`);
  if (result.error || result.status !== 0) throw new Error(`${logName}: ${result.error?.code || result.status}`);
  return result.stdout;
}
const docker = (...args) => capture("docker", ["--host", host, ...args]);
assert.equal(capture("git", ["rev-parse", "--show-toplevel"]).replaceAll("\\", "/"), "C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2");
assert.equal(capture("git", ["remote", "get-url", "origin"]), "https://github.com/duotapmobile/ApplyPack.git");
assert.equal(existsSync(local), false, "fresh exclusive image attempt required");
assert.equal(docker("images", "--quiet", tag), "", "do not overwrite an existing image tag");
mkdirSync(local, { recursive: true });
for (const part of ["input", "output", "tmp"]) mkdirSync(resolve(local, part));
const inventory = () => JSON.parse(capture(process.execPath, ["docs/evidence/launch-execution-2026-10-22/operations/capture-launch-inputs.mjs"]));
const before = inventory();
write("image-inputs-before.json", before);
const start = new Date().toISOString();
let scannerName;
let scannerCreated = false;
try {
  run("docker", ["--host", host, "build", "--progress=plain", "--pull=false", "--network=default", "--platform=linux/amd64",
    "--file", "Dockerfile.launch", "--target", "web", "--tag", tag,
    "--build-arg", "NEXT_PUBLIC_APP_URL=https://applypack-staging-staging.up.railway.app",
    "--build-arg", "NEXT_PUBLIC_SUPABASE_URL=https://fmugizadzdnqfckujqlw.supabase.co",
    "--build-arg", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_image_validation_only",
    "--build-arg", "APP_DEPLOYMENT_ENV=staging", "."], "image-build.log");
  const afterBuild = inventory();
  assert.deepEqual(afterBuild.files, before.files, "image inputs changed during build");
  write("image-inputs-after-build.json", afterBuild);
  const identity = JSON.parse(docker("image", "inspect", tag))[0];
  write("image-identity.json", identity);
  const smokeText = run(process.execPath, ["scripts/test-launch-image.mjs", tag], "image-smoke.log", 600000);
  const smoke = JSON.parse(smokeText.trim());
  assert.equal(smoke.status, "PASS");
  assert.equal(smoke.imageId, identity.Id);
  assert.equal(smoke.teardownVerified, true);
  const archive = resolve(local, "input/image.tar");
  run("docker", ["--host", host, "image", "save", "--output", archive, tag], "image-save.log", 600000);
  const archiveHash = sha(archive);
  const tarEntry = (name) => execFileSync("tar", ["-xOf", archive, name], { cwd: root,
    windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const blob = (digest) => {
    assert.match(digest, /^sha256:[a-f0-9]{64}$/);
    const bytes = tarEntry(`blobs/sha256/${digest.slice(7)}`);
    assert.equal(`sha256:${hashBytes(bytes)}`, digest);
    return JSON.parse(bytes.toString("utf8"));
  };
  const archiveIndex = JSON.parse(tarEntry("index.json").toString("utf8"));
  assert.equal(archiveIndex.manifests.length, 1);
  assert.equal(archiveIndex.manifests[0].digest, identity.Id);
  const imageIndex = blob(identity.Id);
  const platformManifest = imageIndex.manifests.filter((entry) => entry.platform?.architecture === "amd64" && entry.platform?.os === "linux");
  assert.equal(platformManifest.length, 1);
  const manifest = blob(platformManifest[0].digest);
  const configDigest = manifest.config.digest;
  const savedConfig = blob(configDigest);
  assert.deepEqual(savedConfig.rootfs.diff_ids, identity.RootFS.Layers);
  const saveManifest = JSON.parse(tarEntry("manifest.json").toString("utf8"));
  assert.equal(saveManifest.length, 1);
  assert.equal(saveManifest[0].Config, `blobs/sha256/${configDigest.slice(7)}`);
  assert.deepEqual(saveManifest[0].RepoTags, [tag]);
  write("image-archive-binding.json", { archiveSha256: archiveHash, imageId: identity.Id,
    imageManifestDigest: platformManifest[0].digest, imageConfigDigest: configDigest,
    rootfsDiffIds: savedConfig.rootfs.diff_ids, tag, digestChainVerified: true });
  const tool = resolve(scanRoot, "tool/trivy");
  const db = resolve(scanRoot, "cache/db/trivy.db");
  const toolHash = sha(tool);
  const dbHash = sha(db);
  assert.equal(toolHash, "d1dfca6ae10a1ad4540bb94e64f0510077c47008920a9b554986b39dca573d83");
  assert.equal(dbHash, "0f73904c4479e500481f7caa499395de97574ceb4f82042af0ce9ad65c135457");
  scannerName = `applypack-recovery-ci-scan-${randomUUID()}`;
  docker("create", "--name", scannerName, "--pull", "never", "--network", "none", "--read-only", "--user", "1000:1000",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "2g", "--cpus", "2", "--pids-limit", "128", "--no-healthcheck",
    "--mount", `type=bind,source=${resolve(scanRoot, "tool")},target=/scanner,readonly`,
    "--mount", `type=bind,source=${resolve(scanRoot, "cache")},target=/cache`,
    "--mount", `type=bind,source=${resolve(local, "input")},target=/input,readonly`,
    "--mount", `type=bind,source=${resolve(local, "output")},target=/output`,
    "--mount", `type=bind,source=${resolve(local, "tmp")},target=/tmp`,
    "--entrypoint", "/scanner/trivy", scannerImage,
    "image", "--cache-dir", "/cache", "--input", "/input/image.tar", "--offline-scan", "--skip-db-update", "--skip-java-db-update",
    "--skip-check-update", "--skip-version-check", "--disable-telemetry", "--scanners", "vuln", "--severity", "HIGH,CRITICAL",
    "--ignorefile", "/dev/null", "--exit-code", "1", "--timeout", "10m", "--parallel", "1", "--no-progress", "--format", "json",
    "--output", "/output/vulnerabilities.json");
  scannerCreated = true;
  const scannerBefore = JSON.parse(docker("inspect", scannerName))[0];
  assert.equal(scannerBefore.HostConfig.NetworkMode, "none");
  assert.equal(scannerBefore.HostConfig.ReadonlyRootfs, true);
  assert.equal(scannerBefore.Config.User, "1000:1000");
  assert.equal(Object.keys(scannerBefore.HostConfig.PortBindings || {}).length, 0);
  write("image-scan-container-before.json", scannerBefore);
  run("docker", ["--host", host, "start", "--attach", scannerName], "image-scan.log", 660000);
  const scannerAfter = JSON.parse(docker("inspect", scannerName))[0];
  write("image-scan-container-after.json", scannerAfter);
  assert.equal(scannerAfter.State.Running, false);
  assert.equal(scannerAfter.State.ExitCode, 0);
  const reportPath = resolve(local, "output/vulnerabilities.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.Metadata.ImageID, configDigest);
  assert.deepEqual(report.Metadata.DiffIDs, savedConfig.rootfs.diff_ids);
  assert.deepEqual(report.Metadata.RepoTags, [tag]);
  assert.equal(sha(archive), archiveHash);
  assert.equal(existsSync(resolve(base, "image-vulnerabilities.json")), false);
  copyFileSync(reportPath, resolve(base, "image-vulnerabilities.json"));
  const coverage = JSON.parse(run(process.execPath, ["scripts/assert-launch-image-scan.mjs", reportPath], "image-scan-validator.log"));
  assert.equal(sha(tool), toolHash);
  assert.equal(sha(db), dbHash);
  docker("rm", scannerName);
  scannerCreated = false;
  assert.equal(docker("ps", "--all", "--quiet", "--filter", `name=^/${scannerName}$`), "");
  const final = inventory();
  assert.deepEqual(final.files, before.files, "image inputs changed through final scan");
  write("image-inputs-final.json", final);
  write("image-validation.json", { status: "PASS_LOCAL", startedAt: start, finishedAt: new Date().toISOString(),
    scope: "Uncommitted image refresh for recovery CI tooling; no release approval or hosted proof", imageId: identity.Id, imageConfigDigest: configDigest,
    sourceInputCount: before.files.length, sourceInventorySha256: before.inventorySha256, sourceChanges: 0,
    collectorSha256: sha(import.meta.filename), archiveSha256: archiveHash, archiveAndScanIdentityVerified: true, scannerBinarySha256: toolHash,
    vulnerabilityDatabaseSha256: dbHash, databaseMetadata: JSON.parse(readFileSync(resolve(scanRoot, "cache/db/metadata.json"), "utf8")),
    smoke, scan: coverage, scannerNetwork: "none", scannerUid: 1000, scannerSocketMounted: false,
    scannerDatabaseUpdates: false, ignoredFindings: [], scannerTeardownVerified: true, imagePushed: false,
    buildNetwork: "default for public pinned/authenticated dependency retrieval", applicationProviderCredentialsSupplied: false,
    runtimeSmokeProviderCalls: 0,
    publicStagingPlaceholderConfiguration: true, candidateGitSha: null });
  console.log("PASS_LOCAL_IMAGE_REFRESH");
} catch (error) {
  write("image-validation-failure.json", { status: "FAIL", startedAt: start, observedAt: new Date().toISOString(),
    code: String(error.message), scannerName: scannerName || null, sourceInventorySha256: before.inventorySha256 });
  throw error;
} finally {
  if (scannerCreated) {
    docker("rm", "--force", scannerName);
    assert.equal(docker("ps", "--all", "--quiet", "--filter", `name=^/${scannerName}$`), "");
  }
}
