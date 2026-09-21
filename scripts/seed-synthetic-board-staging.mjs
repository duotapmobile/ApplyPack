import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const requiredArgument = "--confirm-staging-synthetic";
const sourceId = "synthetic-staging";
const employerId = "applypack-synthetic-lab";

function fail(message) {
  throw new Error(`Synthetic staging seed refused: ${message}`);
}

function stagingContext() {
  if (!process.argv.includes(requiredArgument)) fail(`pass ${requiredArgument}`);
  if (process.env.APP_STAGING_SYNTHETIC_JOBS !== "true") fail("APP_STAGING_SYNTHETIC_JOBS must be true");
  if (process.env.APP_ALLOW_SYNTHETIC_SEED !== "true") fail("APP_ALLOW_SYNTHETIC_SEED must be true");
  if (process.env.APP_PAYMENT_MODE === "live" || process.env.APP_LIVE_PAYMENTS_ENABLED === "true") fail("live payments are enabled");
  const railwayEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  if (railwayEnvironment && railwayEnvironment !== "staging") fail(`Railway environment is ${railwayEnvironment}`);

  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
  if (appUrl.protocol !== "https:") fail("NEXT_PUBLIC_APP_URL must be HTTPS");
  if (["applypack.work", "www.applypack.work"].includes(appUrl.hostname.toLowerCase())) fail("the application URL is production");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !secret) fail("staging Supabase service credentials are missing");
  return { appUrl, supabaseUrl, secret };
}

const sha = (value) => createHash("sha256").update(value).digest("hex");

function fixtures(appUrl, now = new Date()) {
  const posted = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const verified = now.toISOString();
  const closing = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
  const definitions = [
    ["support-remote", "Customer Support Specialist", "remote_us_nationwide", "w2_full_time", 21, 28, "hour", false, "mixed", "Customer service, issue resolution, data entry, scheduling, written communication, and technical support."],
    ["success-remote", "Customer Success Coordinator", "remote_us_nationwide", "w2_full_time", 52000, 64000, "year", false, "low", "Customer service, onboarding, scheduling, documentation, data entry, and written communication."],
    ["operations-hybrid", "Operations Assistant", "hybrid", "w2_full_time", 48000, 59000, "year", false, "low", "Data entry, scheduling, customer service, documentation, spreadsheets, and process coordination."],
    ["admin-part-time", "Administrative Support Associate", "remote_us_nationwide", "w2_part_time", 19, 24, "hour", false, "low", "Scheduling, data entry, customer service, calendar management, email, and document preparation."],
    ["technical-support", "Technical Support Representative", "remote_us_state_limited", "w2_full_time", 23, 31, "hour", false, "mixed", "Technical support, troubleshooting, customer service, documentation, and written communication."],
    ["implementation", "Implementation Coordinator", "remote_us_nationwide", "w2_full_time", 57000, 70000, "year", false, "low", "Onboarding, project coordination, customer service, documentation, training, and scheduling."],
    ["data-quality", "Data Quality Specialist", "remote_us_nationwide", "temporary", 22, 27, "hour", false, "none_or_unknown", "Data entry, quality assurance, spreadsheets, research, documentation, and attention to detail."],
    ["sales-support", "Sales Support Coordinator", "remote_us_nationwide", "w2_full_time", 50000, 62000, "year", true, "mixed", "Customer service, sales support, scheduling, data entry, and written communication."],
    ["phone-support", "Contact Center Representative", "remote_us_nationwide", "w2_full_time", 18, 23, "hour", false, "high", "Customer service, phone support, issue resolution, documentation, and data entry."],
    ["contract-research", "Research Operations Contractor", "remote_us_nationwide", "independent_contractor", 30, 38, "hour", false, "low", "Research, data entry, quality assurance, documentation, spreadsheets, and written communication."],
    ["onsite-coordinator", "Office Services Coordinator", "onsite", "w2_full_time", 45000, 54000, "year", false, "mixed", "Customer service, scheduling, document preparation, data entry, and office coordination."],
    ["unknown-pay", "Client Services Associate", "remote_us_nationwide", "w2_full_time", null, null, null, false, "mixed", "Customer service, issue resolution, scheduling, documentation, and written communication."],
  ];
  return definitions.map(([key, title, workMode, employmentType, salaryMin, salaryMax, payPeriod, salesFlag, phoneIntensity, description], index) => {
    const applicationUrl = new URL("/staging/synthetic-application", appUrl);
    applicationUrl.searchParams.set("job", String(key));
    const canonical = `${sourceId}:${key}:${title}:${description}`;
    return {
      external_job_id: `SYNTH-${String(index + 1).padStart(3, "0")}`,
      company: "ApplyPack Synthetic Lab - fictional",
      title,
      source_url: applicationUrl.toString(),
      location_text: workMode === "hybrid" || workMode === "onsite" ? "Test City, NY (fictional)" : "United States (fictional remote test)",
      salary_text: salaryMin === null ? "Compensation not supplied (synthetic warning case)" : `$${salaryMin}-$${salaryMax} per ${payPeriod}`,
      checked_at: verified,
      listing_status: "open",
      canonical_employer_id: employerId,
      employer_display_name: "ApplyPack Synthetic Lab - fictional",
      employer_aliases: [],
      source_id: sourceId,
      source_name: "ApplyPack synthetic staging inventory",
      source_category: "third_party_aggregator",
      is_official_source: false,
      is_direct_employer_source: false,
      official_application_url: applicationUrl.toString(),
      source_job_url: applicationUrl.toString(),
      normalized_source_url: applicationUrl.toString(),
      normalized_title: String(title).toLowerCase(),
      raw_title: title,
      description,
      department: "Synthetic staging verification",
      employment_type: employmentType,
      w2_or_contractor: employmentType === "independent_contractor" ? "contractor" : "w2",
      work_mode: workMode,
      remote_scope: workMode.startsWith("remote_") ? "United States" : null,
      eligible_states: workMode === "remote_us_state_limited" || workMode === "hybrid" || workMode === "onsite" ? ["NY"] : null,
      eligible_countries: ["US"],
      timezone_requirement: null,
      schedule_type: employmentType === "w2_part_time" ? "part_time" : "full_time",
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: salaryMin === null ? null : "USD",
      pay_period: payPeriod,
      pay_model: payPeriod === "year" ? "salary" : salaryMin === null ? "unknown" : "hourly",
      phone_intensity: phoneIntensity,
      sales_flag: salesFlag,
      commission_flag: false,
      marketing_flag: false,
      high_volume_contact_center_flag: key === "phone-support",
      degree_required: null,
      experience_level: "early_career",
      equipment_requirement: workMode.startsWith("remote_") ? "Employer-provided test equipment" : null,
      equipment_cost_responsibility: "employer",
      applicant_cost: 0,
      benefits_status: employmentType === "independent_contractor" || employmentType === "temporary" ? "not_provided" : "provided",
      language_requirements: ["English"],
      posted_at: posted,
      closing_at: closing,
      last_verified_at: verified,
      source_freshness_status: "fresh",
      content_hash: sha(canonical),
      deduplication_key: sha(`${employerId}:${key}`),
      is_active: true,
      review_status: "approved",
      rejection_reason: null,
    };
  });
}

async function upsertFixture(client, row) {
  const existing = await client.from("jobs").select("id").eq("source_id", sourceId).eq("external_job_id", row.external_job_id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const result = await client.from("jobs").update(row).eq("id", existing.data.id).select("id").single();
    if (result.error) throw result.error;
    return { id: result.data.id, created: false };
  }
  const result = await client.from("jobs").insert(row).select("id").single();
  if (result.error) throw result.error;
  return { id: result.data.id, created: true };
}

async function main() {
  const context = stagingContext();
  const client = createClient(context.supabaseUrl, context.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const employer = await client.from("employers").upsert({ id: employerId, display_name: "ApplyPack Synthetic Lab - fictional", source_category: "unclassified", aliases: [], is_active: true, updated_at: now.toISOString() }, { onConflict: "id" });
  if (employer.error) throw employer.error;
  const source = await client.from("job_sources").upsert({
    id: sourceId, canonical_employer_id: employerId, source_name: "ApplyPack synthetic staging inventory",
    source_category: "third_party_aggregator", official_url: new URL("/staging/synthetic-application", context.appUrl).toString(),
    alternate_official_urls: [], adapter_kind: "existing_import", adapter_key: null, automation_status: "pending_verification",
    is_official: false, is_direct_employer: false, is_active: true, priority: -100, ats_platform: "none",
    ats_tenant_identifier: "none", access_method: "manual_import", refresh_schedule: null, schedule_enabled: false,
    ingestion_permission_status: "unverified", paid_display_permission_status: "unverified", permission_evidence_url: null,
    notes: "FICTIONAL STAGING-ONLY INVENTORY. Never evidence of source authorization, live ingestion, or launch readiness.",
    health_status: "synthetic_staging", last_health_checked_at: now.toISOString(), last_successful_sync_at: null, updated_at: now.toISOString(),
  }, { onConflict: "id" });
  if (source.error) throw source.error;

  let created = 0;
  let updated = 0;
  for (const row of fixtures(context.appUrl, now)) {
    const result = await upsertFixture(client, row);
    if (result.created) created += 1; else updated += 1;
    const reference = {
      job_id: result.id, source_id: sourceId, source_name: "ApplyPack synthetic staging inventory",
      source_job_url: row.source_job_url, normalized_source_url: row.normalized_source_url,
      official_application_url: row.official_application_url, external_job_id: row.external_job_id,
      is_official: false, is_direct_employer: false, last_verified_at: now.toISOString(), is_active: true,
    };
    const existingReference = await client.from("job_source_references").select("id").eq("job_id", result.id).eq("source_id", sourceId).eq("external_job_id", row.external_job_id).maybeSingle();
    if (existingReference.error) throw existingReference.error;
    const stored = existingReference.data
      ? await client.from("job_source_references").update(reference).eq("id", existingReference.data.id)
      : await client.from("job_source_references").insert(reference);
    if (stored.error) throw stored.error;
  }
  const run = await client.from("job_source_runs").insert({ source_id: sourceId, status: "succeeded", started_at: now.toISOString(), completed_at: new Date().toISOString(), fetched_count: created + updated, accepted_count: created + updated, rejected_count: 0, error_code: "SYNTHETIC_STAGING_ONLY", error_message: "Fictional staging data; not a live or authorized-source run." }).select("id").single();
  if (run.error) throw run.error;
  console.log(JSON.stringify({ status: "SYNTHETIC_STAGING_SEEDED", sourceId, runId: run.data.id, created, updated, total: created + updated, realSourceEvidence: false }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
