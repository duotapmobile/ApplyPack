import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Runs only an already-built local image, without credentials, ports or external networking.
const image = process.argv[2];
if (!image || !/^applypack-launch-web:[a-z0-9][a-z0-9._-]*$/.test(image)) {
  throw new Error("usage: node scripts/test-launch-image.mjs applypack-launch-web:<local-tag>");
}
const host = process.platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
const docker = (...args) => execFileSync("docker", ["--host", host, ...args], {
  encoding: "utf8", timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true,
});
const metadata = JSON.parse(docker("image", "inspect", image))[0];
assert.equal(metadata.Config.User, "1000:1000");
const name = `applypack-launch-proof-${randomUUID()}`;
let created = false;
let receipt;
try {
  docker("create", "--name", name, "--pull", "never", "--network", "none", "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--tmpfs", "/app/.next/cache:rw,nosuid,nodev,uid=1000,gid=1000,size=32m",
    "--shm-size", "16m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--env", "APP_DEPLOYMENT_ENV=staging", "--env", `APP_EXPECTED_RELEASE_SHA=${"a".repeat(40)}`,
    "--env", "NEXT_PUBLIC_APP_URL=https://applypack-staging-staging.up.railway.app",
    "--env", "NEXT_PUBLIC_SUPABASE_URL=https://fmugizadzdnqfckujqlw.supabase.co",
    "--env", "APP_PAYMENT_MODE=test", metadata.Id);
  created = true;
  const isolated = JSON.parse(docker("inspect", name))[0];
  assert.equal(isolated.HostConfig.NetworkMode, "none");
  assert.equal(isolated.HostConfig.ReadonlyRootfs, true);
  assert.equal(Object.keys(isolated.HostConfig.PortBindings || {}).length, 0);
  docker("start", name);
  const proof = docker("exec", name, "node", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    const base = "http://127.0.0.1:3000";
    let live;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      try { live = await fetch(base + "/api/live", { signal: AbortSignal.timeout(1000) }); if (live.ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(live?.status, 200, "production process must start");
    const homepage = await fetch(base, { signal: AbortSignal.timeout(15000) });
    assert.equal(homepage.status, 200);
    assert.match(homepage.headers.get("x-robots-tag"), /noindex/);
    assert.match(await homepage.text(), /ApplyPack/);
    const robots = await fetch(base + "/robots.txt", { signal: AbortSignal.timeout(15000) });
    assert.equal(robots.status, 200); assert.match(await robots.text(), /Disallow: \\/(?:\\s|$)/);
    const health = await fetch(base + "/api/health", { signal: AbortSignal.timeout(15000) });
    assert.equal(health.status, 503, "unconfigured image must fail closed");
    const status = await health.json();
    assert.equal(status.acceptingOrders, false); assert.equal(status.sessionCreationConfigured, false);
    console.log(JSON.stringify({ liveStatus: live.status, homeStatus: homepage.status,
      stagingNoindex: true, readinessStatus: health.status, acceptingOrders: false,
      sessionCreationConfigured: false }));
  `);
  const credentialPackage = JSON.parse(docker("exec", name, "node", "scripts/check-launch-container.mjs"));
  const runtimeChecks = JSON.parse(docker("exec", name, "node", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { spawnSync } from "node:child_process";
    import { runMaintenanceOnce } from "./scripts/run-maintenance-once.mjs";
    const invalid = spawnSync(process.execPath, ["scripts/run-maintenance-once.mjs"], {
      encoding: "utf8", timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH }, shell: false,
    });
    assert.equal(invalid.error, undefined);
    assert.equal(invalid.status, 1);
    assert.deepEqual(JSON.parse(invalid.stdout).codes, ["MAINTENANCE_REQUEST_FAILED"]);
    let requests = 0; let versionRequests = 0;
    const synthetic = await runMaintenanceOnce({
      APP_MAINTENANCE_URL: "https://applypack-staging-staging.up.railway.app/api/cron/maintenance",
      CRON_SECRET: "synthetic-local-smoke-value",
      APP_DEPLOYMENT_ENV: "staging",
      APP_EXPECTED_RELEASE_SHA: "a".repeat(40),
    }, async (url, options) => {
      assert.equal(url.origin, "https://applypack-staging-staging.up.railway.app");
      if (options.method === "GET") {
        versionRequests++;
        assert.equal(url.pathname, "/api/health");
        assert.equal(options.headers.authorization, undefined);
        return new Response(JSON.stringify({ releaseSha: "a".repeat(40), checks: { releaseSha: true } }), { status: 503 });
      }
      requests++;
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers["x-applypack-expected-environment"], "staging");
      assert.equal(options.headers["x-applypack-expected-release-sha"], "a".repeat(40));
      return new Response(JSON.stringify({ ok: true,
        deployment: { environment: "staging", releaseSha: "a".repeat(40) }, diagnostics: {
        actions: [{ code: "SYNTHETIC_LOCAL_PROBE", status: "SUCCEEDED" }],
        unresolvedCodes: [], failedActionCodes: [],
      } }), { status: 200 });
    });
    assert.equal(versionRequests, 1); assert.equal(requests, 1); assert.equal(synthetic.exitCode, 0); assert.equal(synthetic.report.ready, true);
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 2, height: 2, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const pixels = await sharp(png).metadata();
    assert.equal(pixels.format, "png"); assert.equal(pixels.width, 2); assert.equal(pixels.height, 2);
    console.log(JSON.stringify({ maintenanceCliShellFree: true, maintenanceUnconfiguredDenied: true,
      maintenanceSyntheticSuccess: true, nativeSharpVerified: true, providerCalls: 0 }));
  `));
  receipt = { schemaVersion: 1, scope: "local-launch-image-smoke", imageId: metadata.Id,
    imageCreatedAt: metadata.Created, nodeVersion: credentialPackage.nodeVersion,
    runtimeUid: credentialPackage.uid, helperSha256: credentialPackage.helperSha256,
    helperAndParentsRootOwned: true, ephemeralStorage: "tmpfs", applicationBuildVerified: true,
    networkMode: "none", publishedPorts: 0, providerCalls: 0, credentialsRead: false,
    shellAbsent: credentialPackage.shellAbsent, packageManagerAbsent: credentialPackage.packageManagerAbsent,
    osPackageMetadataPreserved: credentialPackage.osPackageMetadataPreserved,
    helperProvenanceAndLicensesPresent: credentialPackage.helperProvenanceAndLicensesPresent,
    releaseApprovalProven: false, ...JSON.parse(proof), ...runtimeChecks };
} catch (error) {
  // The isolated container receives no secrets; its startup log is useful build evidence.
  if (created) process.stderr.write(docker("logs", name));
  throw error;
} finally {
  if (created) {
    docker("rm", "--force", name);
    assert.equal(docker("ps", "--all", "--quiet", "--filter", `name=^/${name}$`).trim(), "");
  }
}
console.log(JSON.stringify({ ...receipt, status: "PASS", teardownVerified: true }));
