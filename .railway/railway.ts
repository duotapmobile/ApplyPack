import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  type RailwayContext,
} from "railway/iac";

const EXPECTED_PROJECT_ID = "fb5a58c4-8ccb-4205-82f9-8b8738c84e56";
const EXPECTED_PROJECT_NAME = "Apply Pack";
const EXPECTED_ENVIRONMENT_ID = "6633e585-5bcd-4729-b167-2a99628daf86";
const EXPECTED_ENVIRONMENT_NAME = "staging";
const STAGING_CUTOVER_AUTHORIZATION_ENV =
  "APPLYPACK_RAILWAY_IAC_STAGING_CUTOVER_AUTHORIZATION";
const STAGING_CUTOVER_AUTHORIZATION_VALUE =
  "apply:fb5a58c4-8ccb-4205-82f9-8b8738c84e56:6633e585-5bcd-4729-b167-2a99628daf86";

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

  const web = service("ApplyPack-staging", {
    source: github("duotapmobile/ApplyPack", {
      branch: "codex/manual-launch-hardening-2026-10-02",
      checkSuites: false,
    }),
    healthcheck: "/api/live",
    healthcheckTimeout: 120,
    replicas: { ams: 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    networking: { privateNetworkEndpoint: "applypack-staging" },
    env: {
      APP_ADMIN_ALERT_EMAIL: preserve(),
      APP_ADMIN_EMAILS: preserve(),
      APP_ALLOW_SYNTHETIC_SEED: preserve(),
      APP_ANONYMOUS_DRAFT_SESSION_SECONDS: preserve(),
      APP_APPLY_PACK_CAPACITY_PER_ROLLING_24H: preserve(),
      APP_BOARD_WORKER_ID: preserve(),
      APP_CAPACITY_RESERVATION_MINUTES: preserve(),
      APP_CHECKOUT_ENABLED: preserve(),
      APP_CHUNK4_WORKER_ID: preserve(),
      APP_CORRECTION_WINDOW_DAYS: preserve(),
      APP_DEPLOYMENT_ENV: preserve(),
      APP_DISPLAY_TIMEZONE: preserve(),
      APP_EMAIL_DELIVERY_VERIFIED_AT: preserve(),
      APP_EMAIL_RECIPIENT_MODE: preserve(),
      APP_FILE_PROCESSING_ENABLED: preserve(),
      APP_FILE_SCAN_MODE: preserve(),
      APP_JOB_BOARD_CHECKOUT_ENABLED: preserve(),
      APP_JOB_FRESHNESS_HOURS: preserve(),
      APP_JOB_SOURCE_MAX_POSTINGS: preserve(),
      APP_JOB_SOURCE_MIN_INTERVAL_MS: preserve(),
      APP_JOB_SOURCE_PROJECTION_ENABLED: preserve(),
      APP_JOB_SOURCE_SYNC_ENABLED: preserve(),
      APP_JOB_SOURCE_TIMEOUT_MS: preserve(),
      APP_JOB_SOURCE_USER_AGENT: preserve(),
      APP_JOB_STALE_AFTER_HOURS: preserve(),
      APP_LEGAL_ENTITY_NAME: preserve(),
      APP_LIVE_PAYMENTS_ENABLED: preserve(),
      APP_MAINTENANCE_MAX_AGE_MINUTES: preserve(),
      APP_PARSER_MAX_EXPANDED_BYTES: preserve(),
      APP_PARSER_MAX_MEMORY_BYTES: preserve(),
      APP_PARSER_MAX_MILLISECONDS: preserve(),
      APP_PARSER_MAX_PAGES: preserve(),
      APP_PAYMENT_MODE: preserve(),
      APP_PERMITTED_MODEL_POLICY: preserve(),
      APP_RENDERER_RUNTIME_DISCOVERY: preserve(),
      APP_SAFE_TEST_EMAILS: preserve(),
      APP_SANDBOXED_PARSER_IDENTITY: preserve(),
      APP_SEARCH_CAPACITY_PER_ROLLING_24H: preserve(),
      APP_SOURCE_DOCUMENT_RETENTION_DAYS: preserve(),
      APP_STAGING_SYNTHETIC_JOBS: preserve(),
      CRON_SECRET: preserve(),
      EMAIL_FROM_ADDRESS: preserve(),
      EMAIL_REPLY_TO: preserve(),
      GIT_COMMIT_SHA: preserve(),
      NEXT_PUBLIC_APP_URL: preserve(),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: preserve(),
      NEXT_PUBLIC_SUPABASE_URL: preserve(),
      RESEND_API_KEY: preserve(),
      STRIPE_APPLY_PACK_PRICE_ID: preserve(),
      STRIPE_JOB_BOARD_MONTHLY_PRICE_ID: preserve(),
      STRIPE_JOB_BOARD_THREE_MONTH_PRICE_ID: preserve(),
      STRIPE_JOB_BOARD_WEEKLY_PRICE_ID: preserve(),
      STRIPE_JOB_SEARCH_PRICE_ID: preserve(),
      STRIPE_SECRET_KEY: preserve(),
      STRIPE_WEBHOOK_SECRET: preserve(),
      SUPABASE_SECRET_KEY: preserve(),
    },
  });

  const maintenance = service("ApplyPack-maintenance", {
    source: github("duotapmobile/ApplyPack", {
      branch: "codex/manual-launch-hardening-2026-10-02",
      checkSuites: false,
      rootDirectory: "/",
    }),
    build: "node --check scripts/run-maintenance-once.mjs",
    start: "node scripts/run-maintenance-once.mjs",
    replicas: { ams: 1 },
    deploy: {
      cronSchedule: "0 * * * *",
      restartPolicyType: "NEVER",
    },
    networking: { privateNetworkEndpoint: "applypack-maintenance" },
    env: {
      APP_MAINTENANCE_URL: preserve(),
      CRON_SECRET: preserve(),
      GIT_COMMIT_SHA: preserve(),
    },
  });

  return project(EXPECTED_PROJECT_NAME, {
    resources: [web, maintenance],
  });
});
