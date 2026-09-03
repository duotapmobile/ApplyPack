import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scanSql = readFileSync(resolve(process.cwd(), "supabase/migrations/202609020004_private_file_scanning.sql"), "utf8").replace(/\s+/g, " ");
const workflowSql = readFileSync(resolve(process.cwd(), "supabase/migrations/202609020005_workflow_orchestration.sql"), "utf8").replace(/\s+/g, " ");
const paymentSql = readFileSync(resolve(process.cwd(), "supabase/migrations/202609020006_payment_safety.sql"), "utf8").replace(/\s+/g, " ");

describe("file scanning and workflow migrations", () => {
  it("stores one private verdict per uploaded source document", () => {
    expect(scanSql).toContain("create table public.source_documents");
    expect(scanSql).toContain("unique(intake_id, document_kind)");
    expect(scanSql).toContain("scan_status in ('pending','clean','blocked','scan_error')");
    expect(scanSql).toContain("source_document_admin_select");
    expect(scanSql).not.toContain("customer_id = auth.uid()");
  });

  it("unlocks intake payment only after every document is clean", () => {
    expect(scanSql).toContain("not exists(select 1 from public.source_documents where intake_id = p_intake_id and scan_status <> 'clean')");
    expect(scanSql).toContain("when aggregate_status = 'clean' then 'ready_for_payment'");
  });

  it("queues paid searches and Apply Pack items exactly once", () => {
    expect(workflowSql).toContain("unique(task_kind, reference_id)");
    expect(workflowSql).toContain("orders_enqueue_paid_work_after_write");
    expect(workflowSql).toContain("apply_pack_items_enqueue_work_after_insert");
    expect(workflowSql).toContain("for update skip locked");
  });

  it("claims each Stripe webhook and ignores expired reservations during capacity checks", () => {
    expect(paymentSql).toContain("claim_stripe_webhook");
    expect(paymentSql).toContain("processing_status = 'processing'");
    expect(paymentSql).toContain("status = 'reserved' and expires_at > now()");
  });
});
