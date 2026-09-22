import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { configureRendererRuntime } from "./configure-renderer-runtime.mjs";

const require = createRequire(import.meta.url);
try {
  configureRendererRuntime();
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", ...process.argv.slice(2)], {
    env: process.env, stdio: "inherit", windowsHide: true,
  });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.once("error", () => { console.error("production_server_start_failed"); process.exitCode = 1; });
  child.once("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143); });
} catch (error) {
  console.error(error instanceof Error ? error.message : "renderer_runtime_configuration_failed");
  process.exitCode = 1;
}
