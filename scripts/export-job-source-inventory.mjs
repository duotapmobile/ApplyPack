import { mkdir, writeFile } from "node:fs/promises";
import { affiliateDirectories, jobSources } from "../src/lib/jobs/source-registry.ts";

const auditedAt = "2026-09-08";
const boundedEndpointObservations = new Map([
  ["vipdesk-connect", "HTTP 200; 2 published endpoint postings; not ingested"],
  ["five-star-call-centers", "HTTP 200; 81 published endpoint postings; not ingested"],
  ["duolingo", "HTTP 200; 89 published endpoint postings; not ingested"],
  ["ultimate-medical-academy", "HTTP 200; 8 published endpoint postings; not ingested"],
  ["brightwheel", "HTTP 200; 19 published endpoint postings; not ingested"],
  ["outschool", "HTTP 200; 4 published endpoint postings; not ingested"],
  ["stripe", "HTTP 200; 619 published endpoint postings; not ingested"],
  ["block", "HTTP 200; 206 published endpoint postings; not ingested"],
  ["coinbase", "HTTP 200; 206 published endpoint postings; not ingested"],
]);
const rows = jobSources.map((source) => {
  const inventoryGroup = source.canonicalEmployerId ? "direct_employer_or_ats_tenant" : "job_board_aggregator_or_feed";
  const status = !source.isActive ? "blocked" : source.scheduleEnabled ? "active scheduled" : source.automationStatus === "automated" ? "configured but unverified" : source.automationStatus === "existing_import" ? "manual batch" : "configured but unverified";
  const migration = ["duolingo","ultimate-medical-academy","brightwheel","classdojo","capella-university","outschool","stripe","block","coinbase","edtech-com-fully-remote"].includes(source.id)
    ? "supabase/migrations/202609080022_job_source_audit_and_requested_batch.sql"
    : "supabase/migrations/202609020003_job_source_expansion.sql";
  return {
    inventory_group: inventoryGroup, source_id: source.id, name: source.sourceName, source_url: source.officialUrl || "unknown",
    exact_access_url: adapterEndpoint(source),
    ats_platform: source.atsPlatform || (source.adapterKind === "lever" ? "lever" : source.adapterKind === "existing_import" ? "none" : "unknown"),
    ats_tenant_identifier: source.atsTenantIdentifier || source.adapterKey || "unknown", access_method: source.accessMethod || (source.adapterKind === "existing_import" ? "manual_import" : "manual_official_career_page"),
    configuration_location: `src/lib/jobs/source-registry.ts#jobSources:${source.id}; ${migration}`, status,
    last_attempted_ingestion: "never; zero job_source_runs in staging and production at audit time",
    last_successful_ingestion: "never; zero job_source_runs in staging and production at audit time",
    evidence: `staging and production Supabase job_source_runs=0, jobs=0, job_source_references=0; audited ${auditedAt}`,
    bounded_endpoint_observation: boundedEndpointObservations.get(source.id) || "not tested",
    refresh_schedule: source.scheduleEnabled ? (source.refreshSchedule || "workflow-triggered") : "none",
    jobs_fetched_last_successful_run: "0 (no successful run)", current_unique_active_jobs: "0", current_verified_remote_jobs: "0",
    ingestion_permission_status: source.ingestionPermissionStatus || (source.adapterKind === "existing_import" ? "unverified" : "manual_research_only"),
    paid_board_display_permission_status: source.paidDisplayPermissionStatus || (source.isDirectEmployer ? "direct_link_only" : "unverified"),
    permission_evidence: source.permissionEvidenceUrl || source.officialUrl || "unknown",
    restrictions_or_missing_configuration: source.notes || (source.automationStatus === "official_link_only" ? "No structured adapter configured; manual official-page research only." : "unknown"),
  };
});

for (const directory of affiliateDirectories) rows.push({
  inventory_group: "reference_directory_not_ingestion_source", source_id: directory.id, name: directory.name, source_url: directory.officialUrl,
  exact_access_url: directory.officialUrl,
  ats_platform: "none", ats_tenant_identifier: "none", access_method: "manual_official_career_page",
  configuration_location: `src/lib/jobs/source-registry.ts#affiliateDirectories:${directory.id}; supabase/migrations/202609020003_job_source_expansion.sql`,
  status: "configured but unverified", last_attempted_ingestion: "never", last_successful_ingestion: "never", evidence: `directory registry only; audited ${auditedAt}`,
  bounded_endpoint_observation: "not tested",
  refresh_schedule: "none", jobs_fetched_last_successful_run: "0 (no successful run)", current_unique_active_jobs: "0", current_verified_remote_jobs: "0",
  ingestion_permission_status: "manual_research_only", paid_board_display_permission_status: "direct_link_only", permission_evidence: directory.officialUrl,
  restrictions_or_missing_configuration: directory.notes,
});

const columns = Object.keys(rows[0]);
const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n") + "\n";
const markdown = [
  "# ApplyPack current job-source inventory",
  "",
  `Generated from the canonical runtime registry on ${auditedAt}. Operational counts are a point-in-time reconciliation against both connected staging and production databases.`,
  "",
  "| Group | Name | Careers URL | Exact access URL | ATS / tenant | Access | Status | Last attempt | Last success | Bounded endpoint observation | Last successful fetch | Active unique | Verified remote | Permission | Configuration | Restrictions |",
  "|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---|---|---|",
  ...rows.map((row) => `| ${cell(row.inventory_group)} | ${cell(row.name)} | ${link(row.source_url)} | ${link(row.exact_access_url)} | ${cell(`${row.ats_platform} / ${row.ats_tenant_identifier}`)} | ${cell(row.access_method)} | ${cell(row.status)} | ${cell(row.last_attempted_ingestion)} | ${cell(row.last_successful_ingestion)} | ${cell(row.bounded_endpoint_observation)} | ${cell(row.jobs_fetched_last_successful_run)} | ${cell(row.current_unique_active_jobs)} | ${cell(row.current_verified_remote_jobs)} | ${cell(`${row.ingestion_permission_status}; paid display: ${row.paid_board_display_permission_status}`)} | ${cell(row.configuration_location)} | ${cell(row.restrictions_or_missing_configuration)} |`),
  "",
].join("\n");

await mkdir("docs/audits", { recursive: true });
await writeFile("docs/audits/JOB_SOURCE_INVENTORY_2026-09-08.csv", csv);
await writeFile("docs/audits/JOB_SOURCE_INVENTORY_2026-09-08.md", markdown);
process.stdout.write(`Wrote ${rows.length} inventory rows.\n`);

function quote(value) { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function cell(value) { return String(value ?? "unknown").replaceAll("|", "\\|").replaceAll("\n", " "); }
function link(value) { return value === "unknown" ? "unknown" : `[${cell(value)}](${value})`; }
function adapterEndpoint(source) {
  if (source.adapterKind === "lever") return `https://api.lever.co/v0/postings/${encodeURIComponent(source.adapterKey)}?mode=json`;
  if (source.adapterKind === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.adapterKey)}/jobs?content=true`;
  if (source.adapterKind === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.adapterKey)}?includeCompensation=true`;
  return source.officialUrl || "unknown";
}
