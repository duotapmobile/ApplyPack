import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const image = process.argv[2];
assert(process.argv.length === 3 && /^applypack-database-recovery:[a-z0-9][a-z0-9._-]*$/u.test(image || ""), "DATABASE_RECOVERY_IMAGE_ARGUMENTS");
const host = process.platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
const docker = (args, input) => execFileSync("docker", ["--host", host, ...args],
  { input, encoding: "utf8", timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true });
const metadata = JSON.parse(docker(["image", "inspect", image]))[0];
assert.equal(metadata.Config.User, "65534:65534");
assert.deepEqual(metadata.Config.Entrypoint, ["/usr/local/bin/node", "scripts/run-database-recovery.mjs"]);
const isolation = ["--pull", "never", "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=256m",
  "--shm-size", "32m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "768m", "--pids-limit", "64"];
// PostgreSQL base-image VOLUME declarations must not create persistent anonymous
// data volumes during a disposable fixture run.
for (const volume of Object.keys(metadata.Config.Volumes || {})) {
  assert(/^\/var\/lib\/postgresql(?:\/data)?$/u.test(volume), "unexpected image volume");
  isolation.push("--tmpfs", `${volume}:rw,noexec,nosuid,nodev,size=16m`);
}
const names = []; let receipt;
try {
  const disabled = `applypack-db-disabled-${randomUUID()}`;
  docker(["create", "--name", disabled, ...isolation, metadata.Id]); names.push(disabled);
  let result;
  try { docker(["start", "--attach", disabled]); assert.fail("unconfigured worker must fail"); }
  catch (error) { result = JSON.parse(String(error.stderr).trim()); }
  assert.deepEqual(result, { status: "FAILED", code: "DATABASE_RECOVERY_RUN_DISABLED" });
  assert.equal(JSON.parse(docker(["inspect", disabled]))[0].State.ExitCode, 1);
  const name = `applypack-db-roundtrip-${randomUUID()}`;
  docker(["create", "--name", name, ...isolation, "--interactive", "--workdir", "/app/scripts",
    "--env", "AP_DATABASE_RECOVERY_OFFLINE_SMOKE=synthetic-network-none", "--entrypoint", "/usr/local/bin/node",
    metadata.Id, "--input-type=module", "-"]); names.push(name);
  const state = JSON.parse(docker(["inspect", name]))[0];
  assert.equal(state.HostConfig.NetworkMode, "none"); assert.equal(state.HostConfig.ReadonlyRootfs, true);
  assert.equal(Object.keys(state.HostConfig.PortBindings || {}).length, 0);
  assert.equal((state.Mounts || []).some((mount) => mount.Type !== "tmpfs"), false);
  receipt = JSON.parse(docker(["start", "--attach", "--interactive", name],
    readFileSync(new URL("./database-recovery-image-fixture.mjs", import.meta.url), "utf8")).trim());
  assert.equal(receipt.status, "PASS"); assert.equal(JSON.parse(docker(["inspect", name]))[0].State.ExitCode, 0);
} finally {
  for (const name of names) { docker(["rm", "--force", "--volumes", name]); assert.equal(docker(["ps", "--all", "--quiet", "--filter", `name=^/${name}$`]).trim(), ""); }
}
console.log(JSON.stringify({ ...receipt, imageId: metadata.Id, defaultStartupDenied: true,
  networkMode: "none", publishedPorts: 0, teardownVerified: true }));
