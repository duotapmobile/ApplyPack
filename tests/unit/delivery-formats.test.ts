import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const customerRoute = readFileSync(resolve(process.cwd(), "src/app/api/customer/deliveries/[id]/route.ts"), "utf8");
const portalActions = readFileSync(resolve(process.cwd(), "src/components/portal/delivery-actions.tsx"), "utf8");
const portalPage = readFileSync(resolve(process.cwd(), "src/app/my-applypack/page.tsx"), "utf8");
const adminDelivery = readFileSync(resolve(process.cwd(), "src/app/api/admin/apply-pack-items/[id]/deliver/route.ts"), "utf8");
const correctionDelivery = readFileSync(resolve(process.cwd(), "src/app/api/admin/corrections/[id]/resolve/route.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202609030022_delivery_formats.sql"), "utf8");

describe("reviewed customer delivery formats", () => {
  it("offers clearly labeled editable Word and PDF choices with Google Docs guidance", () => {
    expect(portalActions).toContain("Word (.docx)");
    expect(portalActions).toContain("Open with Google Docs");
    expect(portalActions).toContain("Use the PDF for viewing, printing, or sending");
    expect(portalActions).toContain("?kind=resume&format=pdf");
    expect(portalActions).toContain("?kind=cover_letter&format=pdf");
  });

  it("keeps old Word links compatible and hides unavailable historical PDF links", () => {
    expect(customerRoute).toContain('get("format") || "docx"');
    expect(portalActions).toContain("pdfAvailable ?");
    expect(portalPage).toContain("Boolean(item.resume_pdf_path && item.cover_letter_pdf_path)");
  });

  it("keeps downloads private, customer-owned, delivery-only, short-lived, and audited by format", () => {
    expect(customerRoute).toContain("order.customer_id !== authData.user.id");
    expect(customerRoute).toContain('order.status !== "delivered"');
    expect(customerRoute).toContain('storage.from("customer-deliveries").createSignedUrl(path, 60');
    expect(customerRoute).toContain("format: format.data");
    expect(customerRoute).toContain('Cache-Control", "no-store, private');
  });

  it("requires and safety-checks all four reviewed files for original and corrected delivery", () => {
    for (const route of [adminDelivery, correctionDelivery]) {
      expect(route).toContain('form.get("resumePdf")');
      expect(route).toContain('form.get("coverLetterPdf")');
      expect(route).toContain("reviewedFiles.map");
      expect(route).toContain("validateDocumentSafety(file)");
      expect(route).toContain("scanFile(file, { structureValidated: true })");
      expect(route.indexOf("const scans = await Promise.all")).toBeLessThan(route.indexOf('storage.from("customer-deliveries").upload'));
    }
  });

  it("records both formats atomically on current items and immutable revisions", () => {
    expect(migration).toContain("add column resume_pdf_path text");
    expect(migration).toContain("add column cover_letter_pdf_path text");
    expect(migration).toContain("p_resume_pdf_path text");
    expect(migration).toContain("p_cover_letter_pdf_path text");
    expect(migration).not.toContain("drop function if exists public.complete_apply_pack_item_delivery");
    expect(migration).not.toContain("drop function if exists public.complete_correction_delivery");
    expect(migration).toContain("apply_pack_delivery_revisions");
    expect(migration).toContain("jsonb_build_array('docx','pdf')");
  });
});
