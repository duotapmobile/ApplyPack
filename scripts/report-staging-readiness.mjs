import { createClient } from "@supabase/supabase-js";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const environment = (process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "").trim().toLowerCase();
if (environment && environment !== "staging") fail("Refusing readiness report outside the staging environment.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("Staging Supabase runtime credentials are missing.");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const supabaseHost = new URL(url).hostname;
const tables = [
  "profiles", "intake_drafts", "intakes", "source_documents", "orders", "payments",
  "apply_pack_carts", "apply_pack_items", "jobs", "job_matches", "job_source_runs",
  "email_events", "audit_logs", "ap_intake_snapshots", "ap_board_profile_claims",
  "ap_board_subscriptions", "ap_board_admissions", "ap_board_recompute_jobs",
  "ap_board_material_orders",
];

const tableCounts = {};
const probeColumns = { ap_board_profile_claims: "profile_snapshot_id" };
for (const table of tables) {
  const probe = await client.from(table).select(probeColumns[table] || "id").limit(1);
  if (probe.error) {
    tableCounts[table] = { available: false, code: probe.error.code || "query_failed" };
    continue;
  }
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  tableCounts[table] = error
    ? { available: false, code: error.code || "query_failed" }
    : { available: true, count: typeof count === "number" ? count : "unknown" };
}

const requiredVariables = [
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_JOB_SEARCH_PRICE_ID",
  "STRIPE_APPLY_PACK_PRICE_ID", "STRIPE_JOB_BOARD_WEEKLY_PRICE_ID",
  "STRIPE_JOB_BOARD_MONTHLY_PRICE_ID", "STRIPE_JOB_BOARD_THREE_MONTH_PRICE_ID",
  "RESEND_API_KEY", "CRON_SECRET", "APP_BOARD_WORKER_ID",
  "APP_DOCUMENT_RENDERER_IDENTITY", "APP_MALWARE_SCANNER_IDENTITY",
];
const variablePresence = Object.fromEntries(requiredVariables.map((name) => [name, Boolean(process.env[name])]));

const sourceQuery = await client.from("job_sources").select(
  "id,source_name,adapter_kind,is_active,schedule_enabled,automation_status,ingestion_permission_status,paid_display_permission_status,last_successful_sync_at",
);
const runQuery = await client.from("job_source_runs").select(
  "id,source_id,status,started_at,completed_at,fetched_count,accepted_count,rejected_count,error_code",
).order("started_at", { ascending: false }).limit(10);
const jobQuery = await client.from("jobs").select("source_id,is_active,listing_status");

const sources = sourceQuery.data || [];
const runs = runQuery.data || [];
const jobs = jobQuery.data || [];
const sourceEvidence = {
  queryErrors: [sourceQuery.error?.code, runQuery.error?.code, jobQuery.error?.code].filter(Boolean),
  registeredSources: sources.length,
  scheduledSources: sources.filter((source) => source.schedule_enabled).length,
  realAutomatedPaidDisplaySources: sources.filter((source) => source.id !== "synthetic-staging"
    && source.is_active && source.schedule_enabled && source.automation_status === "automated"
    && source.ingestion_permission_status === "approved_public_endpoint"
    && source.paid_display_permission_status === "approved_public_endpoint").length,
  realRuns: runs.filter((run) => run.source_id !== "synthetic-staging").length,
  realActiveJobs: jobs.filter((job) => job.source_id !== "synthetic-staging" && job.is_active && job.listing_status?.toLowerCase() === "open").length,
  syntheticActiveJobs: jobs.filter((job) => job.source_id === "synthetic-staging" && job.is_active && job.listing_status?.toLowerCase() === "open").length,
  syntheticSource: sources.find((source) => source.id === "synthetic-staging") || null,
  recentSyntheticRuns: runs.filter((run) => run.source_id === "synthetic-staging"),
};

process.stdout.write(JSON.stringify({
  generatedAt: new Date().toISOString(),
  environment: environment || "unreported",
  project: process.env.RAILWAY_PROJECT_NAME || "unreported",
  service: process.env.RAILWAY_SERVICE_NAME || "unreported",
  applicationUrl: process.env.NEXT_PUBLIC_APP_URL || null,
  supabaseHost,
  paymentMode: process.env.APP_PAYMENT_MODE || "disabled",
  checkoutEnabled: process.env.APP_CHECKOUT_ENABLED === "true",
  boardCheckoutEnabled: process.env.APP_JOB_BOARD_CHECKOUT_ENABLED === "true",
  livePaymentsEnabled: process.env.APP_LIVE_PAYMENTS_ENABLED === "true",
  sourceSyncEnabled: process.env.APP_JOB_SOURCE_SYNC_ENABLED === "true",
  syntheticBoardEnabled: process.env.APP_STAGING_SYNTHETIC_JOBS === "true",
  variablePresence,
  tableCounts,
  sourceEvidence,
}, null, 2) + "\n");
