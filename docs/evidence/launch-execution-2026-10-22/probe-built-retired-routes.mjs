import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// Bounded diagnostic for the existing immutable build; no rebuild, credentials,
// external network, published ports, mounted host files or persistent writes.
const expectedImage = "sha256:d9a489a347ce9b0518f9364cdfef3f0b363ad0352c0296ca407f8e8d85f02939";
const expectedConfig = "sha256:6146c0557c83fc9c424b23d68dc750177eb458161c47e035fa546ef8fa3c6719";
const output = process.argv[2];
assert.match(output || "", /^docs\/evidence\/launch-execution-2026-10-22\/browser-built-route-probe\.json$/);
const docker = (...args) => execFileSync("docker", ["--host", "npipe:////./pipe/dockerDesktopLinuxEngine", ...args], {
  encoding: "utf8", timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true,
});
const metadata = JSON.parse(docker("image", "inspect", expectedImage))[0];
assert.equal(metadata.Id, expectedImage);
assert.equal(metadata.Config.User, "1000:1000");
const accepted = JSON.parse(readFileSync("docs/evidence/launch-execution-2026-10-22/operations/launch-image-results.json", "utf8"));
assert.equal(accepted.imageId, expectedImage);
assert.equal(accepted.imageConfigDigest, expectedConfig);
const name = `applypack-retired-route-proof-${randomUUID()}`;
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
  assert.equal(isolated.Mounts.every((mount) => mount.Type === "tmpfs"), true);
  docker("start", name);
  const proof = docker("exec", name, "node", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    const base = "http://127.0.0.1:3000";
    const start = performance.now();
    let live;
    while (performance.now() - start < 180000) {
      try { live = await fetch(base + "/api/live", { signal: AbortSignal.timeout(1000) }); if (live.ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(live?.status, 200, "production process starts");
    const startupMs = Math.round(performance.now() - start);
    const specs = [
      { path: "/job-board", status: 404, robots: true },
      { path: "/api/checkout/job-board", method: "POST", data: {}, status: 410, notOffered: true },
      { path: "/api/checkout/board-materials/10000000-0000-4000-8000-000000000001", method: "POST", data: {}, status: 410 },
      { path: "/my-applypack/job-board", status: 404 },
      { path: "/my-applypack/job-board/10000000-0000-4000-8000-000000000001", status: 404 },
      { path: "/api/customer/job-board", status: 410, noStore: true, notOffered: true },
      { path: "/api/customer/job-board/10000000-0000-4000-8000-000000000001", status: 410, noStore: true, notOffered: true },
      { path: "/api/customer/job-board/10000000-0000-4000-8000-000000000001/apply-link", status: 410, noStore: true, notOffered: true },
      { path: "/api/customer/billing/portal", method: "POST", status: 410, noStore: true, billing: true },
    ];
    const results = [];
    for (const spec of specs) {
      const started = performance.now();
      const response = await fetch(base + spec.path, { method: spec.method || "GET",
        ...(spec.data ? { headers: { "content-type": "application/json" }, body: JSON.stringify(spec.data) } : {}),
        signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, spec.status, spec.path);
      if (spec.noStore) assert.match(response.headers.get("cache-control") || "", /no-store/, spec.path);
      if (spec.robots) {
        const html = await response.text();
        const robots = [...html.matchAll(/<meta\\b[^>]*>/gi)].map((match) => match[0])
          .filter((tag) => /\\bname=["']robots["']/i.test(tag));
        assert.ok(robots.length > 0, "robots metadata present");
        assert.ok(robots.every((tag) => /\\bcontent=["'][^"']*noindex[^"']*["']/i.test(tag)), "all robots directives noindex");
      } else if (spec.notOffered || spec.billing) {
        const body = await response.json();
        if (spec.notOffered) assert.match(body.error, /not offered/);
        if (spec.billing) assert.deepEqual(body, { error: "No current legacy billing entitlement was found." });
      } else { await response.arrayBuffer(); }
      results.push({ path: spec.path, method: spec.method || "GET", status: response.status,
        elapsedMs: Math.round(performance.now() - started), allApplicableAssertionsPassed: true });
    }
    console.log(JSON.stringify({ startupMs, results }));
  `);
  receipt = { status: "PASS_LOCAL_BUILT_NEGATIVE_ROUTES", observedAt: new Date().toISOString(),
    scope: "Single isolated observation of nine original retired-route assertions in the previously built production-mode image; no provider or load/latency-SLO claim",
    imageId: metadata.Id, acceptedImageConfigDigest: expectedConfig,
    sourceScriptSha256: createHash("sha256").update(readFileSync(import.meta.filename)).digest("hex"),
    networkMode: "none", readOnlyRootFilesystem: true, runtimeUid: 1000,
    hostMounts: 0, publishedPorts: 0, providerCalls: 0, credentialsRead: false,
    perRequestDiagnosticTimeoutMs: 30000, applicationSourceChanged: false,
    ...JSON.parse(proof) };
} finally {
  if (created) {
    docker("rm", "--force", name);
    assert.equal(docker("ps", "--all", "--quiet", "--filter", `name=^/${name}$`).trim(), "");
  }
}
writeFileSync(output, JSON.stringify({ ...receipt, teardownVerified: true }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ ...receipt, teardownVerified: true }, null, 2));
