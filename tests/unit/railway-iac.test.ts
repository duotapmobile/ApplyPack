import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const EXPECTED_WEB_VARIABLES = [
  "APP_ADMIN_ALERT_EMAIL",
  "APP_ADMIN_EMAILS",
  "APP_ALLOW_SYNTHETIC_SEED",
  "APP_ANONYMOUS_DRAFT_SESSION_SECONDS",
  "APP_APPLY_PACK_CAPACITY_PER_ROLLING_24H",
  "APP_BOARD_WORKER_ID",
  "APP_CAPACITY_RESERVATION_MINUTES",
  "APP_CHECKOUT_ENABLED",
  "APP_CHUNK4_WORKER_ID",
  "APP_CORRECTION_WINDOW_DAYS",
  "APP_DEPLOYMENT_ENV",
  "APP_DISPLAY_TIMEZONE",
  "APP_EMAIL_DELIVERY_VERIFIED_AT",
  "APP_EMAIL_RECIPIENT_MODE",
  "APP_FILE_PROCESSING_ENABLED",
  "APP_FILE_SCAN_MODE",
  "APP_JOB_BOARD_CHECKOUT_ENABLED",
  "APP_JOB_FRESHNESS_HOURS",
  "APP_JOB_SOURCE_MAX_POSTINGS",
  "APP_JOB_SOURCE_MIN_INTERVAL_MS",
  "APP_JOB_SOURCE_PROJECTION_ENABLED",
  "APP_JOB_SOURCE_SYNC_ENABLED",
  "APP_JOB_SOURCE_TIMEOUT_MS",
  "APP_JOB_SOURCE_USER_AGENT",
  "APP_JOB_STALE_AFTER_HOURS",
  "APP_LEGAL_ENTITY_NAME",
  "APP_LIVE_PAYMENTS_ENABLED",
  "APP_MAINTENANCE_MAX_AGE_MINUTES",
  "APP_PARSER_MAX_EXPANDED_BYTES",
  "APP_PARSER_MAX_MEMORY_BYTES",
  "APP_PARSER_MAX_MILLISECONDS",
  "APP_PARSER_MAX_PAGES",
  "APP_PAYMENT_MODE",
  "APP_PERMITTED_MODEL_POLICY",
  "APP_RENDERER_RUNTIME_DISCOVERY",
  "APP_SAFE_TEST_EMAILS",
  "APP_SANDBOXED_PARSER_IDENTITY",
  "APP_SEARCH_CAPACITY_PER_ROLLING_24H",
  "APP_SOURCE_DOCUMENT_RETENTION_DAYS",
  "APP_STAGING_SYNTHETIC_JOBS",
  "CRON_SECRET",
  "EMAIL_FROM_ADDRESS",
  "EMAIL_REPLY_TO",
  "GIT_COMMIT_SHA",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "RESEND_API_KEY",
  "STRIPE_APPLY_PACK_PRICE_ID",
  "STRIPE_JOB_BOARD_MONTHLY_PRICE_ID",
  "STRIPE_JOB_BOARD_THREE_MONTH_PRICE_ID",
  "STRIPE_JOB_BOARD_WEEKLY_PRICE_ID",
  "STRIPE_JOB_SEARCH_PRICE_ID",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_SECRET_KEY",
] as const;

const EXPECTED_MAINTENANCE_VARIABLES = [
  "APP_MAINTENANCE_URL",
  "CRON_SECRET",
  "GIT_COMMIT_SHA",
] as const;

describe("Railway staging Infrastructure as Code", () => {
  it("isolates and pins the reviewed SDK outside the application dependency graph", () => {
    const appPackage = JSON.parse(source("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const iacPackage = JSON.parse(source(".railway/package.json")) as {
      private: boolean;
      devDependencies: Record<string, string>;
    };

    expect(iacPackage.private).toBe(true);
    expect(iacPackage.devDependencies).toEqual({ railway: "3.12.0" });
    expect(appPackage.dependencies.railway).toBeUndefined();
    expect(appPackage.devDependencies.railway).toBeUndefined();
    expect(existsSync(resolve(process.cwd(), ".railway/package-lock.json"))).toBe(true);
    expect(source("tsconfig.json")).toContain('".railway"');
  });

  it("fails closed on every project and environment identity field", () => {
    const config = source(".railway/railway.ts");
    expect(config).toContain('const EXPECTED_PROJECT_ID = "fb5a58c4-8ccb-4205-82f9-8b8738c84e56"');
    expect(config).toContain('const EXPECTED_PROJECT_NAME = "Apply Pack"');
    expect(config).toContain('const EXPECTED_ENVIRONMENT_ID = "6633e585-5bcd-4729-b167-2a99628daf86"');
    expect(config).toContain('const EXPECTED_ENVIRONMENT_NAME = "staging"');
    expect(config).toContain("ctx.projectId === EXPECTED_PROJECT_ID");
    expect(config).toContain("ctx.projectName === EXPECTED_PROJECT_NAME");
    expect(config).toContain("ctx.environmentId === EXPECTED_ENVIRONMENT_ID");
    expect(config).toContain("ctx.environment === EXPECTED_ENVIRONMENT_NAME");
    expect(config).toContain("ctx.environmentName === EXPECTED_ENVIRONMENT_NAME");
    expect(config).toContain('throw new Error("APPLYPACK_RAILWAY_IAC_STAGING_IDENTITY_MISMATCH")');
  });

  it("declares only the two existing staging services with the exact operational settings", () => {
    const config = source(".railway/railway.ts");
    expect(config.match(/service\("/g)).toHaveLength(2);
    expect(config).toContain('service("ApplyPack-staging"');
    expect(config).toContain('service("ApplyPack-maintenance"');
    expect(config).not.toContain('service("ApplyPack",');
    expect(config).toContain('branch: "codex/manual-launch-hardening-2026-10-02"');
    expect(config).toContain('healthcheck: "/api/live"');
    expect(config).toContain("healthcheckTimeout: 120");
    expect(config).toContain('build: "node --check scripts/run-maintenance-once.mjs"');
    expect(config).toContain('start: "node scripts/run-maintenance-once.mjs"');
    expect(config).toContain('cronSchedule: "0 * * * *"');
    expect(config).toContain('restartPolicyType: "NEVER"');
    expect(config).toContain('privateNetworkEndpoint: "applypack-staging"');
    expect(config).toContain('privateNetworkEndpoint: "applypack-maintenance"');

    expect(source("railway.json")).toContain('"startCommand": "npm run start"');
    expect(source("railway-maintenance.json")).toContain('"cronSchedule": "0 * * * *"');
    expect(source("railway.maintenance.json")).toContain('"cronSchedule": "0 * * * *"');
  });

  it("represents every current variable with preserve() and no committed value", () => {
    const config = source(".railway/railway.ts");
    const declaredVariables = [...config.matchAll(/^\s{6}([A-Z][A-Z0-9_]+): preserve\(\),$/gm)]
      .map((match) => match[1]);

    expect(declaredVariables).toEqual([
      ...EXPECTED_WEB_VARIABLES,
      ...EXPECTED_MAINTENANCE_VARIABLES,
    ]);
    expect(config.match(/preserve\(\)/g)).toHaveLength(
      EXPECTED_WEB_VARIABLES.length + EXPECTED_MAINTENANCE_VARIABLES.length,
    );
    expect(config).not.toMatch(/\b(?:sk_(?:live|test)|whsec_|rk_(?:live|test)|re_[A-Za-z0-9])\w*/);
  });

  it("documents a staging-only, plan-only, zero-destroy migration gate", () => {
    const readme = source(".railway/README.md");
    expect(readme).toContain("npm ci --prefix .railway");
    expect(readme).toContain("Production is a separate Railway environment and is not represented by this file.");
    expect(readme).toContain("railway config plan --json --detailed-exit-code");
    expect(readme).toContain("0 to add, 0 to change, 0 to destroy");
    expect(readme).toContain("Abort if the plan proposes any add, change, or destroy action.");
    expect(readme).toContain("railway config migrate --apply");
    expect(readme).toContain("It is not authorized by this source commit.");
    expect(readme).toContain("Do not use `--delete-files`");
  });
});
