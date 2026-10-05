export const RENDERER_RUNTIME_DISCOVERY_FAILURE_FLAG = "APP_RENDERER_RUNTIME_DISCOVERY_FAILED";
export const RENDERER_RUNTIME_DISCOVERY_FAILURE_CODE = "renderer_runtime_discovery_failed";

export function startProductionServer({
  environment,
  configureRenderer,
  spawnChild,
  executable,
  nextBinary,
  arguments: serverArguments,
  processHandle,
  reportError,
}) {
  environment[RENDERER_RUNTIME_DISCOVERY_FAILURE_FLAG] = "true";
  try {
    configureRenderer(environment);
    delete environment[RENDERER_RUNTIME_DISCOVERY_FAILURE_FLAG];
  } catch {
    // Renderer discovery is readiness, not process liveness. Never include the
    // provider path or underlying exception in logs.
    reportError(RENDERER_RUNTIME_DISCOVERY_FAILURE_CODE);
  }

  let child;
  try {
    child = spawnChild(executable, [nextBinary, "start", ...serverArguments], {
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {
    reportError("production_server_start_failed");
    processHandle.exitCode = 1;
    return null;
  }

  for (const signal of ["SIGTERM", "SIGINT"]) processHandle.on(signal, () => child.kill(signal));
  child.once("error", () => {
    reportError("production_server_start_failed");
    processHandle.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    processHandle.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
  });
  return child;
}
