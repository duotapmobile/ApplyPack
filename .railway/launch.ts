import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  type RailwayContext,
} from "railway/iac";

import { launchMaintenance } from "./launch-contract.ts";
import { launchWebEnvironment } from "./launch-environment.ts";

const EXPECTED_PROJECT_ID = "fb5a58c4-8ccb-4205-82f9-8b8738c84e56";
const EXPECTED_PROJECT_NAME = "Apply Pack";
const EXPECTED_ENVIRONMENT_ID = "6633e585-5bcd-4729-b167-2a99628daf86";
const EXPECTED_ENVIRONMENT_NAME = "staging";
const STAGING_CUTOVER_AUTHORIZATION_ENV =
  "APPLYPACK_RAILWAY_LAUNCH_STAGING_AUTHORIZATION";
const STAGING_CUTOVER_AUTHORIZATION_VALUE =
  "launch:fb5a58c4-8ccb-4205-82f9-8b8738c84e56:6633e585-5bcd-4729-b167-2a99628daf86";

export default defineRailway((ctx: RailwayContext) => {
  const isExpectedStagingEnvironment =
    ctx.projectId === EXPECTED_PROJECT_ID &&
    ctx.projectName === EXPECTED_PROJECT_NAME &&
    ctx.environmentId === EXPECTED_ENVIRONMENT_ID &&
    ctx.environment === EXPECTED_ENVIRONMENT_NAME &&
    ctx.environmentName === EXPECTED_ENVIRONMENT_NAME;

  if (!isExpectedStagingEnvironment) {
    throw new Error("APPLYPACK_RAILWAY_IAC_STAGING_IDENTITY_MISMATCH");
  }

  const isApplyCommand = ctx.command?.trim().toLowerCase() === "apply";
  if (
    isApplyCommand &&
    process.env[STAGING_CUTOVER_AUTHORIZATION_ENV] !==
      STAGING_CUTOVER_AUTHORIZATION_VALUE
  ) {
    throw new Error("APPLYPACK_RAILWAY_IAC_APPLY_NOT_AUTHORIZED");
  }

  const releaseSha = process.env.APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA;
  const sourceBranch = process.env.APPLYPACK_RAILWAY_LAUNCH_SOURCE_BRANCH || "codex/manual-launch-hardening-2026-10-02";
  if (!["main", "codex/manual-launch-hardening-2026-10-02"].includes(sourceBranch)) {
    throw new Error("APPLYPACK_RAILWAY_LAUNCH_SOURCE_BRANCH_INVALID");
  }
  if ((isApplyCommand || releaseSha !== undefined) && !/^[a-f0-9]{40}$/.test(releaseSha || "")) {
    throw new Error("APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA_REQUIRED");
  }

  const web = service("ApplyPack-staging", {
    source: github("duotapmobile/ApplyPack", {
      branch: sourceBranch,
      checkSuites: true,
      ...(releaseSha ? { commitSha: releaseSha } : {}),
    }),
    configFile: "railway.launch.web.json",
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.launch" },
    healthcheck: "/api/live",
    healthcheckTimeout: 120,
    replicas: { ams: 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    networking: { privateNetworkEndpoint: "applypack-staging" },
    env: { ...launchWebEnvironment(), ...(releaseSha ? { APP_EXPECTED_RELEASE_SHA: releaseSha } : {}) },
  });

  const maintenance = service("ApplyPack-maintenance", {
    source: github("duotapmobile/ApplyPack", {
      branch: sourceBranch,
      checkSuites: true,
      ...(releaseSha ? { commitSha: releaseSha } : {}),
      rootDirectory: "/",
    }),
    configFile: "railway.launch.maintenance.json",
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.launch" },
    start: "node scripts/run-maintenance-once.mjs",
    replicas: { ams: 1 },
    deploy: {
      cronSchedule: launchMaintenance.cronSchedule,
      restartPolicyType: "NEVER",
    },
    networking: { privateNetworkEndpoint: "applypack-maintenance" },
    env: {
      APP_MAINTENANCE_URL: preserve(),
      APP_EXPECTED_RELEASE_SHA: releaseSha || preserve(),
      APP_DEPLOYMENT_ENV: preserve(),
      CRON_SECRET: preserve(),
      GIT_COMMIT_SHA: preserve(),
    },
  });

  return project(EXPECTED_PROJECT_NAME, {
    resources: [web, maintenance],
  });
});
