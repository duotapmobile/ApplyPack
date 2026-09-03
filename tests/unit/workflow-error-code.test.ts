import { describe, expect, it } from "vitest";
import { workflowErrorCode } from "@/lib/workflow/errors";

describe("workflow error codes", () => {
  it("preserves an intentional operational code", () => {
    expect(workflowErrorCode(new Error("generated_draft_scan_failed")))
      .toBe("workflow_generated_draft_scan_failed");
  });

  it("does not persist arbitrary provider or customer details", () => {
    expect(workflowErrorCode(new Error("provider rejected secret@example.com token abc123")))
      .toBe("workflow_processing_failed");
    expect(workflowErrorCode(null)).toBe("workflow_processing_failed");
  });
});
