import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const batchPath = resolve(process.argv[2] || "config/job-source-batches/next-batch.csv");
const inventoryPath = resolve("docs/audits/JOB_SOURCE_INVENTORY_2026-09-08.csv");
const required = ["source_id", "name", "source_url", "category", "ats_platform", "ats_tenant_identifier", "adapter_kind", "access_method", "automation_status", "schedule_enabled", "ingestion_permission_status", "paid_display_permission_status", "priority"];
const adapters = new Set(["lever", "greenhouse", "ashby", "official_link_only", "existing_import"]);
const automatedAdapters = new Set(["lever", "greenhouse", "ashby"]);

const rows = parseCsv(await readFile(batchPath, "utf8"));
if (!rows.length) {
  process.stdout.write(`No source rows to validate in ${batchPath}. The reusable batch template is ready.\n`);
  process.exit(0);
}
for (const field of required) if (!(field in rows[0])) throw new Error(`Missing required column: ${field}`);

let inventory = [];
try { inventory = parseCsv(await readFile(inventoryPath, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const seenIds = new Set(inventory.map((row) => row.source_id).filter(Boolean));
const seenUrls = new Set(inventory.map((row) => normalizeUrl(row.source_url)).filter(Boolean));
const seenTenants = new Set(inventory.map(tenantKey).filter(Boolean));
const errors = [];

for (const [index, row] of rows.entries()) {
  const line = index + 2;
  for (const field of required) if (!String(row[field] || "").trim()) errors.push(`line ${line}: ${field} is required`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.source_id || "")) errors.push(`line ${line}: source_id must be lowercase kebab-case`);
  if (!adapters.has(row.adapter_kind)) errors.push(`line ${line}: unsupported adapter_kind ${row.adapter_kind}`);
  try { if (new URL(row.source_url).protocol !== "https:") errors.push(`line ${line}: source_url must use HTTPS`); } catch { errors.push(`line ${line}: source_url is invalid`); }
  if (seenIds.has(row.source_id)) errors.push(`line ${line}: duplicate source_id ${row.source_id}`); else seenIds.add(row.source_id);
  const normalizedUrl = normalizeUrl(row.source_url);
  if (seenUrls.has(normalizedUrl)) errors.push(`line ${line}: duplicate source_url ${row.source_url}`); else seenUrls.add(normalizedUrl);
  const tenant = tenantKey(row);
  if (tenant && seenTenants.has(tenant)) errors.push(`line ${line}: duplicate ATS tenant ${tenant}`); else if (tenant) seenTenants.add(tenant);
  if (automatedAdapters.has(row.adapter_kind) && row.ingestion_permission_status !== "approved_public_endpoint") errors.push(`line ${line}: structured adapters require approved_public_endpoint permission evidence`);
  if (row.ingestion_permission_status === "approved_public_endpoint" && !row.permission_evidence_url) errors.push(`line ${line}: permission_evidence_url is required for automated ingestion`);
  if (row.paid_display_permission_status === "approved_public_endpoint" && !row.permission_evidence_url) errors.push(`line ${line}: permission evidence is required for paid display`);
  if (row.schedule_enabled === "true") errors.push(`line ${line}: new sources must enter with schedule_enabled=false and pass a bounded ingestion review before activation`);
}

if (errors.length) { process.stderr.write(errors.join("\n") + "\n"); process.exit(1); }
process.stdout.write(JSON.stringify({ ok: true, batchPath, rows: rows.length, message: "Batch is structurally valid. Review permission evidence and run bounded health/fetch tests before registry migration or scheduling." }, null, 2) + "\n");

function tenantKey(row) {
  const platform = String(row.ats_platform || "").trim().toLowerCase();
  const tenant = String(row.ats_tenant_identifier || "").trim().toLowerCase();
  return platform && !["none", "unknown"].includes(platform) && tenant && !["none", "unknown"].includes(tenant) ? `${platform}:${tenant}` : "";
}

function normalizeUrl(value) {
  try { const url = new URL(value); url.hash = ""; url.hostname = url.hostname.toLowerCase(); url.pathname = url.pathname.replace(/\/+$/, "") || "/"; return url.toString(); } catch { return ""; }
}

function parseCsv(text) {
  const records = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (char === '"') quoted = false; else field += char; }
    else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ""; }
    else if (char === '\n') { row.push(field.replace(/\r$/, "")); records.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); records.push(row); }
  const nonempty = records.filter((record) => record.some((value) => value.trim()));
  if (!nonempty.length) return [];
  const headers = nonempty[0].map((value) => value.trim());
  return nonempty.slice(1).map((record) => Object.fromEntries(headers.map((header, index) => [header, (record[index] || "").trim()])));
}
