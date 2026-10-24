import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { configureRendererRuntime } from "./configure-renderer-runtime.mjs";
import { startProductionServer } from "./start-production-runtime.mjs";

const require = createRequire(import.meta.url);
startProductionServer({
  environment: process.env,
  configureRenderer: configureRendererRuntime,
  spawnChild: spawn,
  executable: process.execPath,
  nextBinary: require.resolve("next/dist/bin/next"),
  arguments: process.argv.slice(2),
  processHandle: process,
  reportError: (code) => console.error(code),
});
