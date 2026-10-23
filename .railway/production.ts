import { defineRailway, github, preserve, project, service, type RailwayContext } from "railway/iac";
import { launchLockNames, launchMaintenance } from "./launch-contract.ts";
import { launchWebEnvironment } from "./launch-environment.ts";

export const productionBinding = Object.freeze({
  projectId: "fb5a58c4-8ccb-4205-82f9-8b8738c84e56", projectName: "Apply Pack",
  environmentId: "c841e757-e60d-441e-b951-f5c75244df3e", environmentName: "production",
  webServiceId: "793579f2-525f-463f-90ac-cf6689433cc3", webServiceName: "ApplyPack",
  maintenanceServiceName: "ApplyPack-production-maintenance",
  recoveryServiceName: "ApplyPack-production-recovery",
});

// This authoring guard binds reviewed inputs; it does not establish provider
// identity, cost approval or launch readiness. Inspect the provider plan and
// existing service ID before applying. New maintenance requires the cost quote.
export default defineRailway((ctx: RailwayContext) => {
  const binding = productionBinding;
  if (ctx.projectId !== binding.projectId || ctx.projectName !== binding.projectName
    || ctx.environmentId !== binding.environmentId || ctx.environment !== "production"
    || ctx.environmentName !== "production") {
    throw new Error("APPLYPACK_RAILWAY_IAC_PRODUCTION_IDENTITY_MISMATCH");
  }
  const sha = process.env.APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA || "";
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("APPLYPACK_RAILWAY_LAUNCH_RELEASE_SHA_REQUIRED");
  if (ctx.command?.trim().toLowerCase() === "apply") {
    const quoteDigest = process.env.APPLYPACK_RAILWAY_PRODUCTION_COST_APPROVAL_SHA256 || "";
    const authorization = `launch:${binding.projectId}:${binding.environmentId}:${binding.webServiceId}:${sha}:${quoteDigest}`;
    if (!/^[a-f0-9]{64}$/.test(quoteDigest)
      || process.env.APPLYPACK_RAILWAY_PRODUCTION_WEB_SERVICE_ID !== binding.webServiceId
      || process.env.APPLYPACK_RAILWAY_LAUNCH_PRODUCTION_AUTHORIZATION !== authorization) {
      throw new Error("APPLYPACK_RAILWAY_IAC_PRODUCTION_APPLY_NOT_AUTHORIZED");
    }
  }
  const source = github("duotapmobile/ApplyPack", { branch: "main", commitSha: sha, checkSuites: true, rootDirectory: "/" });
  const web = service(binding.webServiceName, {
    source, configFile: "railway.launch.web.json",
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.launch" },
    healthcheck: "/api/live", healthcheckTimeout: 120,
    deploy: { restartPolicyMaxRetries: 3 },
    networking: { privateNetworkEndpoint: "applypack" },
    env: {
      ...launchWebEnvironment(),
      ...Object.fromEntries(launchLockNames.map((name) => [name, "false"])),
      APP_DEPLOYMENT_ENV: "production", APP_PAYMENT_MODE: "live", APP_EXPECTED_RELEASE_SHA: sha,
      APP_MANUAL_LAUNCH_SCOPE: "MANUAL_ONLY", APP_SEARCH_CAPACITY_PER_ROLLING_24H: "1",
      APP_APPLY_PACK_CAPACITY_PER_ROLLING_24H: "2", APP_ALLOW_SYNTHETIC_SEED: "false",
      APP_STAGING_SYNTHETIC_JOBS: "false",
    },
  });
  const maintenance = service(binding.maintenanceServiceName, {
    source, configFile: "railway.launch.maintenance.json",
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.launch" },
    start: "node scripts/run-maintenance-once.mjs",
    deploy: { cronSchedule: launchMaintenance.cronSchedule, restartPolicyType: "NEVER" },
    networking: { privateNetworkEndpoint: "applypack-production-maintenance" },
    env: {
      APP_MAINTENANCE_URL: preserve(), CRON_SECRET: preserve(), GIT_COMMIT_SHA: preserve(),
      APP_DEPLOYMENT_ENV: "production", APP_EXPECTED_RELEASE_SHA: sha,
    },
  });
  const recovery = service(binding.recoveryServiceName, {
    source, configFile: "railway.launch.recovery.json",
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.launch" },
    start: "node scripts/run-protected-recovery.mjs",
    deploy: { cronSchedule: "*/5 * * * *", restartPolicyType: "NEVER" },
    networking: { privateNetworkEndpoint: "applypack-production-recovery" },
    env: {
      APP_DEPLOYMENT_ENV: "production", APP_BASE_URL: "https://applypack.work", APP_EXPECTED_RELEASE_SHA: sha,
      AWS_REGION: "us-east-1", APP_AWS_ACCOUNT_ID: "838445019912",
      APP_RECOVERY_READER_SECRET: preserve(), APP_RECOVERY_COMPLETION_SECRET: preserve(),
      APP_BACKUP_BUCKET: "applypack-production-protected-recovery-838445019912",
      APP_BACKUP_KMS_KEY_ARN: preserve(), APP_BACKUP_AWS_RA_DEPLOYMENT_ENV: "production",
      APP_BACKUP_AWS_RA_TRUST_ANCHOR_ARN: preserve(), APP_BACKUP_AWS_RA_PROFILE_ARN: preserve(),
      APP_BACKUP_AWS_RA_ROLE_ARN: "arn:aws:iam::838445019912:role/applypack/production/applypack-production-recovery-writer",
      APP_BACKUP_AWS_RA_HELPER_PATH: "/usr/local/bin/aws_signing_helper",
      APP_BACKUP_AWS_RA_CERTIFICATE_PEM_BASE64: preserve(), APP_BACKUP_AWS_RA_PRIVATE_KEY_PEM_BASE64: preserve(),
      APP_BACKUP_AWS_RA_CA_CERTIFICATE_PEM_BASE64: preserve(), APP_BACKUP_AWS_RA_CERTIFICATE_SHA256: preserve(),
      APP_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: preserve(),
    },
  });
  return project(binding.projectName, { resources: [web, maintenance, recovery] });
});
