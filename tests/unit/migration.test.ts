import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609010001_initial.sql"),
  "utf8"
).replace(/\s+/g, " ");

const jobSourceSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609020003_job_source_expansion.sql"),
  "utf8"
).replace(/\s+/g, " ");

describe("production migration invariants", () => {
  it("quarantines new source documents until scanning passes", () => {
    expect(sql).toContain("source_scan_status text not null default 'pending'");
    expect(sql).toContain("source_scan_status in ('pending','clean','blocked')");
  });

  it("limits one Apply Pack cart to the approved two units", () => {
    expect(sql).toContain("item_count integer not null check (item_count between 1 and 2)");
    expect(sql).toContain("reservation_units <> target.item_count");
  });

  it("creates one $8 order and one work item for every paid cart item", () => {
    expect(sql).toContain("unit_price_cents integer not null default 800 check (unit_price_cents = 800)");
    expect(sql).toMatch(/for cart_item in .*?insert into public\.orders\(.*?insert into public\.apply_pack_items\(/);
  });

  it("keeps payment conversion and capacity mutation service-role only", () => {
    expect(sql).toContain("grant execute on function public.complete_paid_checkout");
    expect(sql).toContain("grant execute on function public.complete_apply_pack_cart");
    expect(sql).toContain("grant execute on function public.reserve_capacity");
    expect(sql).toContain("grant execute on function public.consume_rate_limit");
    expect(sql).not.toMatch(/grant execute on function public\.(complete_paid_checkout|complete_apply_pack_cart|reserve_capacity|consume_rate_limit).* to authenticated/);
  });

  it("enables RLS on every customer-data table", () => {
    for (const table of [
      "profiles", "intakes", "intake_answers", "criteria_versions", "orders",
      "apply_pack_carts", "apply_pack_cart_items", "jobs", "job_matches",
      "apply_pack_items", "correction_requests", "conflict_reviews", "refunds",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("keeps both document buckets private", () => {
    expect(sql).toContain("('customer-source-documents', 'customer-source-documents', false)");
    expect(sql).toContain("('customer-deliveries', 'customer-deliveries', false)");
  });
});

describe("job source expansion migration invariants", () => {
  it("adds the normalized fields and preserves legacy columns", () => {
    for (const field of [
      "canonical_employer_id", "employer_display_name", "employer_aliases", "source_id", "source_name",
      "source_category", "official_application_url", "source_job_url", "external_job_id", "normalized_title",
      "raw_title", "description", "employment_type", "w2_or_contractor", "work_mode", "remote_scope",
      "eligible_states", "eligible_countries", "timezone_requirement", "schedule_type", "salary_min", "salary_max",
      "pay_model", "phone_intensity", "sales_flag", "commission_flag", "marketing_flag", "degree_required",
      "experience_level", "equipment_requirement", "applicant_cost", "benefits_status", "last_verified_at",
      "source_freshness_status", "content_hash", "deduplication_key", "is_active", "review_status", "rejection_reason",
    ]) expect(jobSourceSql).toContain(`add column ${field}`);
    for (const legacy of ["company", "title", "source_url", "location_text", "salary_text", "checked_at", "listing_status"]) {
      expect(jobSourceSql).not.toContain(`drop column ${legacy}`);
    }
  });

  it("enforces all three exact deduplication keys and preserves source references", () => {
    expect(jobSourceSql).toContain("jobs_employer_external_id_unique");
    expect(jobSourceSql).toContain("jobs_employer_source_url_unique");
    expect(jobSourceSql).toContain("jobs_employer_dedup_key_unique");
    expect(jobSourceSql).toContain("create table public.job_source_references");
  });

  it("rejects Liveops at both persistence boundaries", () => {
    expect(jobSourceSql).toContain("reject_prohibited_job_source_before_write");
    expect(jobSourceSql).toContain("reject_prohibited_job_reference_before_write");
    expect(jobSourceSql.match(/%liveops%/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("stores aliases as redirects without generic affiliate employers", () => {
    for (const mapping of [
      "'sitel group','Sitel Group','foundever'", "'sykes','SYKES','foundever'", "'teleperformance','Teleperformance','tp'",
      "'aetna','Aetna','cvs-health'", "'turbotax','TurboTax','intuit'", "'discover','Discover','capital-one'",
    ]) expect(jobSourceSql).toContain(mapping);
    expect(jobSourceSql).not.toContain("('blue-cross-blue-shield','Blue Cross Blue Shield'");
    expect(jobSourceSql).not.toContain("('aaa','AAA'");
  });

  it("adds stale-job maintenance, RLS, explicit grants, and ranking reasons", () => {
    expect(jobSourceSql).toContain("mark_stale_jobs_inactive");
    expect(jobSourceSql).toContain("ranking_reason_codes jsonb");
    for (const table of ["employers", "employer_aliases", "job_sources", "job_source_runs", "job_source_references", "job_deduplication_reviews"]) {
      expect(jobSourceSql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(jobSourceSql).toContain("grant all privileges on public.employers");
  });
});
