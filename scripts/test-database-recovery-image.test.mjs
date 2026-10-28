import assert from "node:assert/strict";
import test from "node:test";
import { testDatabaseRecoveryImage } from "./test-database-recovery-image.mjs";
const runId = "11111111-2222-4333-8444-555555555555";
const shipping = { status: "PASS", clientOnly: true, runtime: { clientVersion: "17.11" }, clients: { psql: "hash" } };
function fixture({ mutateImage, mutateState, failAt, ambiguousCreate } = {}) {
  const calls = []; const states = new Map(); const removed = [];
  const images = [0, 1].map((index) => ({ Id: "sha256:" + String(index + 1).repeat(64), Os: "linux", Architecture: "amd64",
    Config: { User: "65534:65534", Entrypoint: ["/nodejs/bin/node", "scripts/run-database-recovery.mjs"],
      Labels: { "org.opencontainers.image.revision": "a".repeat(40) }, Volumes: index ? { "/var/lib/postgresql/data": {} } : {} } }));
  if (mutateImage) mutateImage(images);
  const execute = (command, args, options) => {
    assert.equal(command, "docker"); assert.deepEqual(args.slice(0, 2), ["--host", "unix:///var/run/docker.sock"]);
    calls.push({ args, options }); const operation = args[2];
    if (operation === "image") return JSON.stringify([images[args[4].includes("-fixture:") ? 1 : 0]]);
    if (operation === "create") {
      const name = args[args.indexOf("--name") + 1]; const image = images.find((item) => args.includes(item.Id));
      states.set(name, { Name: "/" + name, Image: image.Id,
        Config: { User: "65534:65534", Labels: { "io.applypack.database-image-fixture": runId } }, State: { ExitCode: name.includes("-disabled-") ? 1 : 0 },
        HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, PortBindings: {}, Binds: [] }, Mounts: [{ Type: "tmpfs" }] });
      if (ambiguousCreate) throw new Error("create response lost"); return name;
    }
    if (operation === "inspect") { const state = structuredClone(states.get(args[3])); if (mutateState) mutateState(state); return JSON.stringify([state]); }
    if (operation === "ps") return states.has(args.at(-1).slice(7, -1)) ? "container-id" : "";
    if (operation === "rm") { states.delete(args.at(-1)); removed.push(args.at(-1)); return ""; }
    if (operation === "start") {
      const name = args.at(-1); if (failAt && name.includes("-" + failAt + "-")) throw new Error("fixture execution failed");
      if (name.includes("-disabled-")) throw Object.assign(new Error("disabled"), { stderr: JSON.stringify({ status: "FAILED", code: "DATABASE_RECOVERY_RUN_DISABLED" }) });
      return JSON.stringify(name.includes("-runtime-") ? shipping : { status: "PASS" });
    }
    throw new Error(operation);
  };
  return { calls, removed, run: (args = ["applypack-database-recovery:ci", "applypack-database-recovery-fixture:ci"]) => testDatabaseRecoveryImage(args,
    { execute, read: () => "import assert from 'node:assert/strict';", platform: "linux", environment: { PATH: "/bin", AWS_SECRET_ACCESS_KEY: "SYNTHETIC" }, uuid: () => runId }) };
}
test("checks shipping image and exact-byte fixture comparison, without forwarding credentials", () => {
  const f = fixture(); const result = f.run(); assert.equal(result.sameClientBytes, true); assert.equal(result.teardownVerified, true);
  assert.equal(f.removed.length, 3); assert(f.calls.every(({ options }) => options.env.AWS_SECRET_ACCESS_KEY === undefined));
  const input = f.calls.find(({ args }) => args[2] === "start" && args.includes("--interactive")).options.input;
  assert(input.includes("assert.deepEqual(actualClients, { ...expectedClients, clientOnly: false })"));
  assert(input.includes(JSON.stringify(shipping)));
});
for (const args of [[], ["applypack-database-recovery:ci"], ["external/image", "applypack-database-recovery-fixture:ci"]])
  test("rejects missing or external image argument", () => { const f = fixture(); assert.throws(() => f.run(args)); assert.equal(f.calls.length, 0); });
for (const mutateImage of [
  (images) => { images[0].Config.Volumes = { "/var/lib/postgresql/data": {} }; },
  (images) => { images[1].Config.Labels["org.opencontainers.image.revision"] = "b".repeat(40); },
  (images) => { images[1].Id = images[0].Id; },
  (images) => { images[0].Config.User = "root"; },
]) test("rejects fixture substitution, server volume, revision or user drift", () => { assert.throws(() => fixture({ mutateImage }).run()); });
for (const failAt of ["runtime", "roundtrip"]) test("failed " + failAt + " check tears down all created containers", () => {
  const f = fixture({ failAt }); assert.throws(() => f.run()); assert.equal(f.removed.length, failAt === "runtime" ? 2 : 3);
});
test("lost create response is reconciled and cleaned", () => {
  const f = fixture({ ambiguousCreate: true }); assert.throws(() => f.run()); assert.equal(f.removed.length, 1);
});
test("unrelated container is never removed", () => {
  const f = fixture({ mutateState: (state) => { state.Config.Labels["io.applypack.database-image-fixture"] = "different"; } });
  assert.throws(() => f.run(), /CLEANUP_FAILED/u); assert.equal(f.removed.length, 0);
});
test("external networking fails before execution and removes the owned fixture", () => {
  const f = fixture({ mutateState: (state) => { state.HostConfig.NetworkMode = "host"; } });
  assert.throws(() => f.run()); assert.equal(f.removed.length, 1);
});
