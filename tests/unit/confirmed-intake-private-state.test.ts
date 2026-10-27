import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fourStepPrivateState } from "@/lib/intake/four-step-server";

describe("visible document facts", () => {
  it("shows the full typed facts and excludes replaced documents and internal relationship IDs", async () => {
    const data: Record<string, unknown[]> = {
      ap_document_versions: [{ id: "current", version: 2, kind: "RESUME", safe_display_name: "resume.pdf", size_bytes: 10, verified_mime_type: "application/pdf", processing_state: "READY" }],
      ap_candidate_facts: [
        { id: "full", document_version_id: "current", customer_display_label: "Employment", customer_display_value: { summary: "Cashier" }, typed_value: { historicalTitle: "Cashier", employer: "Actual Store", dates: "2020–2022", phone: "555 0101", verbatim: "Original source statement", coverLetterEvidence: ["x".repeat(2_000)], employmentFactId: "private-relation-id" }, fact_tier: "SEARCH_CRITICAL", verification: "EXTRACTED_UNCONFIRMED" },
        { id: "stale", document_version_id: "replaced", customer_display_label: "Old fact", customer_display_value: { summary: "Stale employer" }, typed_value: { employer: "Stale employer" } },
      ], ap_fact_presentations: [],
    };
    const filters: unknown[][] = [];
    const from = (table: string) => {
      const query = { select: () => query, limit: () => query, eq: (...args: unknown[]) => { filters.push([table, ...args]); return query; }, is: (...args: unknown[]) => { filters.push([table, ...args]); return query; }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: data[table], error: null })) };
      return query;
    };
    const rpc = vi.fn(() => from("ap_document_versions"));
    const admin = { from, rpc } as unknown as Parameters<typeof fourStepPrivateState>[0];
    const result = await fourStepPrivateState(admin, "draft");
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].displayValue).toContain("Actual Store");
    expect(result.facts[0].displayValue).toContain("2020–2022");
    expect(result.facts[0].displayValue).toContain("555 0101");
    expect(result.facts[0].displayValue).not.toContain("private-relation-id");
    expect(result.facts[0].editableValues?.verbatim).toBe("Original source statement");
    expect(result.facts[0].editableValues?.coverLetterEvidence).toEqual(["x".repeat(2_000)]);
    expect(filters).toContainEqual(["ap_candidate_facts", "snapshot_id", null]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ap_effective_intake_documents", { p_draft_id: "draft" });
  });
  it.each([null, {}, Array.from({ length: 101 }, () => ({}))])("rejects an incomplete or truncated effective-document result", async data => {
    const query = { select: () => query, limit: () => query, eq: () => query, is: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data, error: null })) };
    const admin = { rpc: () => query, from: () => query } as unknown as Parameters<typeof fourStepPrivateState>[0];
    await expect(fourStepPrivateState(admin, "successor")).rejects.toThrow("four_step_state_unavailable");
  });
});
