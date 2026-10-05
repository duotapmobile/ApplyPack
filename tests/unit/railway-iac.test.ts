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

const CUTOVER_AUTHORIZATION_ENV =
  "APPLYPACK_RAILWAY_IAC_STAGING_CUTOVER_AUTHORIZATION";
const CUTOVER_AUTHORIZATION_VALUE =
  "apply:fb5a58c4-8ccb-4205-82f9-8b8738c84e56:6633e585-5bcd-4729-b167-2a99628daf86";

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
    expect(iacPackage.devDependencies).toEqual({
      "@types/node": "22.15.0",
      railway: "3.12.0",
      tsx: "4.23.15",
      typescript: "5.8.3",
    });
    expect(appPackage.dependencies.railway).toBeUndefined();
    expect(appPackage.devDependencies.railway).toBeUndefined();
    expect(existsSync(resolve(process.cwd(), ".railway/package-lock.json"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), ".railway/railway.test.ts"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "tests/fixtures/railway-service-instance-contract-5.49.6.json"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), ".railway/tsconfig.json"))).toBe(true);
    expect(source("tsconfig.json")).toContain('".railway"');

    const workflow = source(".github/workflows/ci.yml");
    expect(workflow).toContain("npm ci --prefix .railway");
    expect(workflow).toContain("npm audit --prefix .railway --audit-level=high");
    expect(workflow).toContain("npm run typecheck --prefix .railway");
    expect(workflow).toContain("npm test --prefix .railway");
    expect(workflow).toContain("scripts/railway-staging-iac-cutover.test.mjs");
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

  it("keeps behavior tests in the isolated package instead of importing it into root TypeScript", () => {
    const testSource = source("tests/unit/railway-iac.test.ts");
    const config = source(".railway/railway.ts");

    expect(testSource).not.toMatch(/await\s+import\s*\(/);
    expect(config).toContain("type RailwayContext");
    expect(config).toContain("(ctx: RailwayContext)");
    expect(source(".railway/package.json")).toContain('"test": "tsx --test railway.test.ts"');
    expect(source(".railway/package.json")).toContain('"typecheck": "tsc --noEmit"');
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

  it("documents a staging-only, pinned-plan, sole-wrapper cutover gate", () => {
    const readme = source(".railway/README.md");
    expect(readme).toContain("npm ci --prefix .railway");
    expect(readme).toContain("Use exactly Railway CLI `5.49.6`");
    expect(readme).toContain("plan's `cliVersion` to be exactly `5.49.6`");
    expect(readme).toContain("Production is a separate Railway environment and is not represented by this file.");
    expect(readme).toContain("scripts/railway-staging-iac-cutover.mjs --dry-run");
    expect(readme).toContain("0 to add, 0 to change, 0 to destroy");
    expect(readme).toContain("Abort if the plan proposes any add, change, or destroy action.");
    expect(readme).toContain("railway config apply --json --yes --plan PATH");
    expect(readme).toContain("The wrapper never invokes `railway config migrate`");
    expect(readme).toContain("It is not authorized by this source commit.");
    expect(readme).toContain(CUTOVER_AUTHORIZATION_ENV);
    expect(readme).toContain(CUTOVER_AUTHORIZATION_VALUE);
    expect(readme).toContain("project token scoped only to the `staging` environment");
    expect(readme).toContain("Account-wide and workspace-wide tokens are prohibited.");
    expect(readme).toContain("project { id name } environment { id name }");
    expect(readme).toContain("Revoke the project token immediately");
    expect(readme).toContain("Direct Railway CLI access cannot be blocked by an authoring callback.");
    expect(readme).toContain("Before loading or validating a provider credential");
    expect(readme).toContain("exact Git blob object ID and canonical SHA-256");
    expect(readme).toContain("clean LF and Windows CRLF checkouts");
    expect(readme).toContain("Each `/api/live` and `/api/health` request has an independent 10-second");
    expect(readme).toContain("latestDeployment.meta.serviceManifest.deploy.multiRegionConfig");
    expect(readme).toContain("SHA-256 contract fingerprint");
  });

  it("documents the value-free rollback receipt and executable restoration", () => {
    const readme = source(".railway/README.md");

    expect(readme).toContain("Mandatory pre-cutover rollback receipt");
    expect(readme).toContain("Do not infer that a retained file currently owns a service setting");
    expect(readme).toContain("`railwayConfigFile` | `null` | `null`");
    expect(readme).toContain("8fefc2dd-0521-4f22-9de8-fdc8b4519c9c");
    expect(readme).toContain("ebf7570e-890c-4799-a62e-5f68a197e7f1");
    expect(readme).toContain("8C18D356C0EE16F939A40E69311B81F554D3A7F5DFFBD7B7C14973B72DCF3A58");
    expect(readme).toContain("EEDFA7D896A451A8BFE6CD53FAF4859243D547777A0544F03E6AA3ED1CC8B106");
    expect(readme).toContain("serviceInstanceUpdate");
    expect(readme).toContain("--variables @private-sanitized-web-rollback-variables.json");
    expect(readme).toContain("Railway `serviceInstanceUpdate` calls are not transactional.");
    expect(readme).not.toContain("@<private");
    for (const field of [
      "autoInstrumentationEnabled",
      "builder",
      "dockerfilePath",
      "drainingSeconds",
      "ipv6EgressEnabled",
      "multiRegionConfig",
      "nixpacksPlan",
      "numReplicas",
      "overlapSeconds",
      "preDeployTimeoutSeconds",
      "sleepApplication",
      "source",
      "tracingEnabled",
      "watchPatterns",
    ]) {
      expect(readme).toContain(`\`${field}\``);
    }
    expect(readme).toContain("write-only `registryCredentials`");
    expect(readme).toContain("`/api/live` HTTP 200");
    expect(readme).toContain("`/api/health` fail-closed with checkout locked");
    expect(readme).toContain("`checks.maintenance: true`");
    expect(readme).toContain("`APP_CHECKOUT_ENABLED`");
    expect(readme).toContain("`APP_LIVE_PAYMENTS_ENABLED`");
    expect(readme).toContain("`APP_JOB_BOARD_CHECKOUT_ENABLED`");
  });

  it("guards the executable wrapper's exact scope, zero-change, and pinned-apply rules", () => {
    const wrapper = source("scripts/railway-staging-iac-cutover.mjs");

    expect(wrapper).toContain("project { id name }");
    expect(wrapper).toContain("environment { id name }");
    expect(wrapper).toContain('"config", "apply", "--json", "--yes", "--plan"');
    expect(wrapper).toContain('"--detailed-exit-code"');
    expect(wrapper).toContain('"--source-tree"');
    expect(wrapper).not.toContain('"config", "migrate"');
    expect(wrapper).not.toContain('"--confirm-destructive"');
    expect(wrapper).toContain('EXPECTED_RAILWAY_CLI_VERSION = "5.49.6"');
    expect(wrapper).toContain("CUTOVER_BOUND_INPUTS");
    expect(wrapper).toContain('".github/workflows/ci.yml"');
    expect(wrapper).toContain('".railway/README.md"');
    expect(wrapper).toContain('"scripts/railway-staging-iac-cutover.test.mjs"');
    expect(wrapper).toContain('"tests/unit/railway-iac.test.ts"');
    expect(wrapper).toContain('"tests/fixtures/railway-service-instance-contract-5.49.6.json"');
    expect(wrapper).toContain("canonicalSha256");
    expect(wrapper).toContain("RAILWAY_IAC_BOUND_INPUT_DIRTY");
    expect(wrapper).toContain("RAILWAY_IAC_CLI_VERSION_MISMATCH");
    expect(wrapper).toContain('phase === "post" ? "RAILWAY_IAC_POST" : "RAILWAY_IAC_PREFLIGHT"');
    expect(wrapper).toContain('fail(`${prefix}_MAINTENANCE_NOT_FRESH`)');
    expect(wrapper).toContain("RAILWAY_IAC_CHECKOUT_NOT_DISABLED");
    expect(wrapper).toContain("ServiceInstanceUpdateInput");
    expect(wrapper).toContain('HOSTED_FETCH_TIMEOUT_MS = 10_000');
    expect(wrapper).toContain("new AbortController()");
    expect(wrapper).toContain('serviceInstance: __type(name: "ServiceInstance")');
    expect(wrapper).toContain('serviceInstanceUpdateInput: __type(name: "ServiceInstanceUpdateInput")');
    expect(wrapper).toContain("deployment.meta?.serviceManifest?.deploy");
    expect(wrapper).toContain("RAILWAY_IAC_DEPLOYMENT_MANIFEST_STALE");
    expect(wrapper).toContain('excludedWriteOnlyFields: ["registryCredentials"]');
    expect(wrapper).toContain("RAILWAY_IAC_ACCOUNT_TOKEN_PROHIBITED");
    expect(wrapper).toContain("RAILWAY_IAC_CONFIG_FILE_BASELINE_MISMATCH");
  });

  it("pins the sanitized live Railway provider contract without inventing multiRegionConfig on ServiceInstance", () => {
    const fixture = JSON.parse(
      source("tests/fixtures/railway-service-instance-contract-5.49.6.json"),
    ) as {
      railwayCliVersion: string;
      serviceInstanceFields: string[];
      serviceInstanceUpdateInputFields: string[];
      response: {
        data: { environment: { serviceInstances: { edges: Array<{ node: Record<string, unknown> }> } } };
      };
    };

    expect(fixture.railwayCliVersion).toBe("5.49.6");
    expect(fixture.serviceInstanceFields).not.toContain("multiRegionConfig");
    expect(fixture.serviceInstanceUpdateInputFields).toContain("multiRegionConfig");
    expect(fixture.serviceInstanceUpdateInputFields).toContain("preDeployTimeoutSeconds");
    for (const { node } of fixture.response.data.environment.serviceInstances.edges) {
      expect(node).not.toHaveProperty("multiRegionConfig");
      expect(node).toHaveProperty(
        "latestDeployment.meta.serviceManifest.deploy.multiRegionConfig.ams.numReplicas",
        1,
      );
    }
  });

  it("keeps Railway SDK and root development advisories separated", () => {
    const readme = source(".railway/README.md");

    expect(readme).toContain("isolated `.railway` package currently audits with zero vulnerabilities");
    expect(readme).toContain("root full development audit separately reports seven pre-existing");
    for (const advisory of [
      "GHSA-vfj7-8cjw-p6xm",
      "GHSA-q2hr-2g5m-vwhr",
      "GHSA-qhr7-859c-m2p7",
      "GHSA-6j4f-fj2g-mc7p",
      "GHSA-rfgv-xxqx-mfg5",
      "GHSA-w293-vg96-wgc3",
    ]) {
      expect(readme).toContain(advisory);
    }
  });
});
