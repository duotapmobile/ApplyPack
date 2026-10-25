import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const entrypoint = ["/nodejs/bin/node", "scripts/run-database-recovery.mjs"];
export function testDatabaseRecoveryImage(args, { execute = execFileSync, read = readFileSync,
  platform = process.platform, environment = process.env, uuid = randomUUID } = {}) {
  assert(args.length === 2 && /^applypack-database-recovery:[a-z0-9][a-z0-9._-]*$/u.test(args[0])
    && /^applypack-database-recovery-fixture:[a-z0-9][a-z0-9._-]*$/u.test(args[1]), "DATABASE_RECOVERY_IMAGE_ARGUMENTS");
  const host = platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
  const childEnvironment = Object.fromEntries(Object.entries(environment).filter(([name]) => /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/iu.test(name)));
  const docker = (parameters, input) => execute("docker", ["--host", host, ...parameters],
    { input, encoding: "utf8", timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true, env: childEnvironment });
  const metadata = args.map((tag) => JSON.parse(docker(["image", "inspect", tag]))[0]);
  for (const item of metadata) {
    assert.match(item.Id, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(item.Os, "linux"); assert.equal(item.Architecture, "amd64");
    assert.equal(item.Config.User, "65534:65534"); assert.deepEqual(item.Config.Entrypoint, entrypoint);
    assert.match(item.Config.Labels?.["org.opencontainers.image.revision"] || "", /^[a-f0-9]{40}$/u);
  }
  assert.equal(metadata[1].Config.Labels["org.opencontainers.image.revision"], metadata[0].Config.Labels["org.opencontainers.image.revision"], "fixture release differs");
  assert.notEqual(metadata[0].Id, metadata[1].Id, "shipping image must exclude fixture server");
  assert.deepEqual(Object.keys(metadata[0].Config.Volumes || {}), [], "shipping image must not declare database volumes");
  const isolation = (item) => {
    const options = ["--pull", "never", "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=256m",
      "--shm-size", "32m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "768m", "--pids-limit", "64"];
    for (const volume of Object.keys(item.Config.Volumes || {})) {
      assert(/^\/var\/lib\/postgresql(?:\/data)?$/u.test(volume), "unexpected image volume");
      options.push("--tmpfs", volume + ":rw,noexec,nosuid,nodev,size=16m");
    }
    return options;
  };
  const runId = uuid(); assert.match(runId, /^[a-f0-9-]{36}$/u);
  const names = []; let receipt; let shipping; let primaryError;
  const ownership = (state, name) => {
    assert.equal(state.Name, "/" + name);
    assert.equal(state.Config.Labels?.["io.applypack.database-image-fixture"], runId, "unrelated container");
  };
  const create = (suffix, item, extra = []) => {
    const name = "applypack-db-" + suffix + "-" + runId; names.push(name);
    docker(["create", "--name", name, "--label", "io.applypack.database-image-fixture=" + runId, ...isolation(item), ...extra, item.Id,
      ...(suffix === "runtime" ? ["scripts/check-database-recovery-runtime.mjs"] : suffix === "roundtrip" ? ["--input-type=module", "-"] : [])]);
    const state = JSON.parse(docker(["inspect", name]))[0]; ownership(state, name);
    assert.equal(state.Image, item.Id); assert.equal(state.Config.User, "65534:65534");
    assert.equal(state.HostConfig.NetworkMode, "none"); assert.equal(state.HostConfig.ReadonlyRootfs, true);
    assert.equal(state.HostConfig.Privileged, false);
    assert.equal(Object.keys(state.HostConfig.PortBindings || {}).length, 0);
    assert.equal((state.Mounts || []).some((mount) => mount.Type !== "tmpfs"), false);
    assert.equal((state.HostConfig.Binds || []).length, 0);
    return name;
  };
  try {
    const disabled = create("disabled", metadata[0]);
    let result;
    try { docker(["start", "--attach", disabled]); assert.fail("unconfigured worker must fail"); }
    catch (error) { result = JSON.parse(String(error.stderr).trim()); }
    assert.deepEqual(result, { status: "FAILED", code: "DATABASE_RECOVERY_RUN_DISABLED" });
    assert.equal(JSON.parse(docker(["inspect", disabled]))[0].State.ExitCode, 1);
    const runtime = create("runtime", metadata[0], ["--entrypoint", "/nodejs/bin/node"]);
    shipping = JSON.parse(docker(["start", "--attach", runtime]).trim());
    assert.equal(shipping.status, "PASS"); assert.equal(shipping.clientOnly, true);
    assert.equal(JSON.parse(docker(["inspect", runtime]))[0].State.ExitCode, 0);
    const name = create("roundtrip", metadata[1], ["--interactive", "--workdir", "/app/scripts",
      "--env", "AP_DATABASE_RECOVERY_OFFLINE_SMOKE=synthetic-network-none", "--entrypoint", "/nodejs/bin/node"]);
    const comparison = "import { checkDatabaseRecoveryRuntime } from './check-database-recovery-runtime.mjs';\n"
      + "const actualClients = checkDatabaseRecoveryRuntime({ fixture: true });\n"
      + "const expectedClients = " + JSON.stringify(shipping) + ";\n"
      + "assert.deepEqual(actualClients, { ...expectedClients, clientOnly: false });\n";
    const fixture = read(new URL("./database-recovery-image-fixture.mjs", import.meta.url), "utf8");
    receipt = JSON.parse(docker(["start", "--attach", "--interactive", name], comparison + fixture).trim());
    assert.equal(receipt.status, "PASS"); assert.equal(JSON.parse(docker(["inspect", name]))[0].State.ExitCode, 0);
  } catch (error) { primaryError = error; }
  finally {
    for (const name of names) {
      try {
        if (docker(["ps", "--all", "--quiet", "--filter", "name=^/" + name + "$"]).trim()) {
          ownership(JSON.parse(docker(["inspect", name]))[0], name);
          docker(["rm", "--force", "--volumes", name]);
        }
        assert.equal(docker(["ps", "--all", "--quiet", "--filter", "name=^/" + name + "$"]).trim(), "");
      } catch (error) { throw new AggregateError([...(primaryError ? [primaryError] : []), error], "DATABASE_RECOVERY_IMAGE_CLEANUP_FAILED"); }
    }
  }
  if (primaryError) throw primaryError;
  return { ...receipt, imageId: metadata[0].Id, fixtureImageId: metadata[1].Id,
    runtimeManifest: shipping.runtime, clients: shipping.clients, sameClientBytes: true, defaultStartupDenied: true,
    networkMode: "none", publishedPorts: 0, teardownVerified: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(testDatabaseRecoveryImage(process.argv.slice(2))));
}
