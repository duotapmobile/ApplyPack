import { beforeEach, describe, expect, it, vi } from "vitest";

const matching = vi.hoisted(() => ({ load: vi.fn(), select: vi.fn(), row: vi.fn() }));
vi.mock("@/lib/matching/persisted-runtime", () => ({
  loadPersistedEvaluationsForOrder: matching.load,
  selectAndPersistEvaluations: matching.select,
  searchCandidateRow: matching.row,
}));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
import { processWorkflowTasks } from "@/lib/workflow/process";

function client(kind = "search_discovery", upsertError: unknown = null) {
  const candidates = new Map<string, Record<string, unknown>>([
    ["job-0", { job_id: "job-0", review_status: "approved" }],
    ["job-1", { job_id: "job-1", review_status: "rejected" }],
  ]);
  const taskWrites: Record<string, unknown>[] = [];
  const admin = {
    rpc: vi.fn().mockResolvedValue({ data: [{ id: "task", task_kind: kind, order_id: "order", reference_id: "item", attempt_count: 1 }], error: null }),
    from: vi.fn((table: string) => {
      const query = {
        eq: vi.fn().mockImplementation(() => query),
        then: (resolve: (value: unknown) => void) => resolve({ error: null }),
        update: vi.fn((row: Record<string, unknown>) => { if (table === "workflow_tasks") taskWrites.push(row); return query; }),
        delete: vi.fn(() => query),
        upsert: vi.fn((rows: Record<string, unknown>[], options: { ignoreDuplicates: boolean }) => {
          for (const row of rows) if (!options.ignoreDuplicates || !candidates.has(String(row.job_id))) candidates.set(String(row.job_id), row);
          return Promise.resolve({ error: upsertError });
        }),
      };
      return query;
    }),
  };
  return { admin, taskWrites, candidates };
}

describe("fulfillment review boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "");
    matching.load.mockResolvedValue([]);
    matching.select.mockResolvedValue({ selected: Array.from({ length: 7 }, (_, n) => ({ id: `job-${n}` })) });
    matching.row.mockImplementation((_order: string, evaluation: { id: string }) => ({ job_id: evaluation.id, review_status: "proposed" }));
  });
  it("escalates seven candidates without padding or completing the order, preserving prior human decisions", async () => {
    const fake = client();
    expect(await processWorkflowTasks(fake.admin as never)).toEqual([{ id: "task", status: "awaiting_review", count: 7 }]);
    expect(fake.candidates.size).toBe(7);
    expect(fake.candidates.get("job-0")?.review_status).toBe("approved");
    expect(fake.candidates.get("job-1")?.review_status).toBe("rejected");
    expect(fake.taskWrites).toContainEqual(expect.objectContaining({ status: "awaiting_review", summary: expect.objectContaining({ researchEscalationRequired: true, remainingCandidateMinimum: 3, deliveryRequiresHumanApprovedCount: 10 }) }));
    expect(fake.taskWrites.some((row) => row.status === "completed")).toBe(false);
  });
  it("does not report review-ready when candidate persistence failed", async () => {
    const fake = client("search_discovery", new Error("database unavailable"));
    expect(await processWorkflowTasks(fake.admin as never)).toEqual([{ id: "task", status: "failed" }]);
    expect(fake.taskWrites.some((row) => row.status === "awaiting_review")).toBe(false);
  });
  it("routes a legacy document task to evidence binding without generating or uploading files", async () => {
    const fake = client("document_draft");
    expect(await processWorkflowTasks(fake.admin as never)).toEqual([{ id: "task", status: "awaiting_review" }]);
    expect(fake.admin.from.mock.calls.map(([table]) => table)).toEqual(["workflow_tasks"]);
    expect(fake.taskWrites[0]).toMatchObject({ last_error_code: "evidence_bound_material_line_required", summary: { action: "MIGRATE_TO_MATERIAL_LINE", generation: "BLOCKED_MISSING_EVIDENCE_BINDING" } });
    expect(matching.load).not.toHaveBeenCalled();
  });
});
