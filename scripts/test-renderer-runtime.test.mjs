import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { configureRendererRuntime } from "./configure-renderer-runtime.mjs";
import {
  RENDERER_RUNTIME_DISCOVERY_FAILURE_CODE,
  RENDERER_RUNTIME_DISCOVERY_FAILURE_FLAG,
  startProductionServer,
} from "./start-production-runtime.mjs";

const digest = createHash("sha256").update("synthetic fixture bytes").digest("hex");
const dependencies = {
  platform: "linux",
  statSync: () => ({ isFile: () => true, size: 23 }),
  readFileSync: () => Buffer.from("synthetic fixture bytes"),
  execFileSync: (path, args, options) => {
    assert.equal(path, "/usr/bin/fc-match");
    assert.equal(args[1], "Arial:style=Regular");
    assert.equal(options.timeout, 5000);
    return "Arial\n/usr/share/fonts/truetype/msttcorefonts/Arial.ttf\n";
  },
};

test("discovery is opt-in and Linux only", () => {
  const environment = {};
  assert.equal(configureRendererRuntime(environment, dependencies), environment);
  assert.deepEqual(environment, {});
  assert.throws(() => configureRendererRuntime({ APP_RENDERER_RUNTIME_DISCOVERY: "true" }, { platform: "win32" }), /requires_linux/);
});
test("installed bytes are pinned without granting any approval", () => {
  const environment = { APP_RENDERER_RUNTIME_DISCOVERY: "true", APP_DOCUMENT_RENDERER_IDENTITY: "explicit-identity" };
  configureRendererRuntime(environment, dependencies);
  assert.equal(environment.APP_LIBREOFFICE_EXECUTABLE, "/usr/bin/soffice");
  assert.equal(environment.APP_PDFINFO_EXECUTABLE_SHA256, digest);
  assert.equal(environment.APP_DOCUMENT_FONT_FILE_SHA256, digest);
  assert.equal(environment.APP_DOCUMENT_RENDERER_IDENTITY, "explicit-identity");
  assert.equal(Object.keys(environment).some((name) => /APPROV|CHECKOUT|PAYMENT/.test(name)), false);
});
test("explicit mismatched pins fail without partially mutating configuration", () => {
  const environment = { APP_RENDERER_RUNTIME_DISCOVERY: "true", APP_PDFINFO_EXECUTABLE_SHA256: "a".repeat(64) };
  const before = { ...environment };
  assert.throws(() => configureRendererRuntime(environment, dependencies), /pin_mismatch/);
  assert.deepEqual(environment, before);
});
test("font fallback and command timeout both fail closed", () => {
  const environment = { APP_RENDERER_RUNTIME_DISCOVERY: "true" };
  assert.throws(() => configureRendererRuntime(environment, { ...dependencies,
    execFileSync: () => "Liberation Sans\n/usr/share/fonts/fallback.ttf\n" }), /renderer_arial_unavailable/);
  assert.throws(() => configureRendererRuntime(environment, { ...dependencies,
    execFileSync: () => { throw new Error("ETIMEDOUT"); } }), /ETIMEDOUT/);
  assert.equal(environment.APP_DOCUMENT_FONT_FILE, undefined);
});

function productionFixture({ environment, configureRenderer }) {
  const events = new Map();
  const signals = new Map();
  const spawned = [];
  const errors = [];
  const child = {
    kill: (signal) => signals.set("forwarded", signal),
    once: (event, handler) => events.set(event, handler),
  };
  const processHandle = {
    exitCode: undefined,
    on: (signal, handler) => signals.set(signal, handler),
  };
  const result = startProductionServer({
    environment,
    configureRenderer,
    spawnChild: (...arguments_) => { spawned.push(arguments_); return child; },
    executable: "/runtime/node",
    nextBinary: "/runtime/next",
    arguments: ["--hostname", "0.0.0.0"],
    processHandle,
    reportError: (code) => errors.push(code),
  });
  return { child, errors, events, processHandle, result, signals, spawned };
}

test("production liveness starts with only a controlled marker when renderer discovery fails", () => {
  const environment = { APP_RENDERER_RUNTIME_DISCOVERY: "true" };
  const fixture = productionFixture({
    environment,
    configureRenderer: () => { throw new Error("renderer failed at /provider/private/path with token-secret"); },
  });
  assert.equal(fixture.result, fixture.child);
  assert.deepEqual(fixture.errors, [RENDERER_RUNTIME_DISCOVERY_FAILURE_CODE]);
  assert.equal(fixture.errors.join(" ").includes("/provider/private/path"), false);
  assert.equal(fixture.errors.join(" ").includes("token-secret"), false);
  assert.equal(environment[RENDERER_RUNTIME_DISCOVERY_FAILURE_FLAG], "true");
  assert.equal(fixture.spawned.length, 1);
  assert.deepEqual(fixture.spawned[0].slice(0, 2), [
    "/runtime/node",
    ["/runtime/next", "start", "--hostname", "0.0.0.0"],
  ]);
  assert.equal(fixture.spawned[0][2].env, environment);
});

test("successful startup discovery preserves pinned configuration and clears failure state", () => {
  const environment = {
    APP_RENDERER_RUNTIME_DISCOVERY: "true",
    APP_DOCUMENT_RENDERER_IDENTITY: "explicit-identity",
    [RENDERER_RUNTIME_DISCOVERY_FAILURE_FLAG]: "true",
  };
  const fixture = productionFixture({
    environment,
    configureRenderer: (target) => configureRendererRuntime(target, dependencies),
  });
  assert.equal(fixture.result, fixture.child);
  assert.deepEqual(fixture.errors, []);
  assert.equal(environment[RENDERER_RUNTIME_DISCOVERY_FAILURE_FLAG], undefined);
  assert.equal(environment.APP_LIBREOFFICE_EXECUTABLE, "/usr/bin/soffice");
  assert.equal(environment.APP_PDFINFO_EXECUTABLE_SHA256, digest);
  assert.equal(environment.APP_DOCUMENT_FONT_FILE_SHA256, digest);
  assert.equal(fixture.spawned[0][2].env, environment);
});
