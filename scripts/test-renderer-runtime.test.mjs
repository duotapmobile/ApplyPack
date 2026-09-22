import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { configureRendererRuntime } from "./configure-renderer-runtime.mjs";

const digest = createHash("sha256").update("synthetic fixture bytes").digest("hex");
const dependencies = {
  platform: "linux",
  statSync: () => ({ isFile: () => true, size: 23 }),
  readFileSync: () => Buffer.from("synthetic fixture bytes"),
  execFileSync: (path, args, options) => {
    assert.equal(path, "/usr/bin/fc-match");
    assert.equal(args[1], "Liberation Sans:style=Regular");
    assert.equal(options.timeout, 5000);
    return "Liberation Sans\n/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf\n";
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
    execFileSync: () => "DejaVu Sans\n/usr/share/fonts/fallback.ttf\n" }), /liberation_sans_unavailable/);
  assert.throws(() => configureRendererRuntime(environment, { ...dependencies,
    execFileSync: () => { throw new Error("ETIMEDOUT"); } }), /ETIMEDOUT/);
  assert.equal(environment.APP_DOCUMENT_FONT_FILE, undefined);
});
