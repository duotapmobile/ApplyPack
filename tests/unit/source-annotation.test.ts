import { describe, expect, it } from "vitest";
import { annotationDisplay, sourceAnnotationSchema } from "@/lib/intake/source-annotation";
describe("source-backed customer annotations", () => {
  const sourceFactIds = ["45000000-0000-4000-8000-000000000001"];
  it("retains historical employment and factual passages without creating verification", () => {
    const annotation = { kind: "EMPLOYMENT" as const, historicalTitle: "Coordinator", employer: "Synthetic Company", dates: "2020–2022", bullets: ["Coordinated schedules."], coverLetterEvidence: ["I maintained the documented team schedule."] };
    const parsed = sourceAnnotationSchema.parse({ sourceFactIds, annotation });
    expect(parsed.annotation).toEqual(annotation);
    expect(annotationDisplay(annotation)).toContain("dates: 2020–2022");
    expect(sourceAnnotationSchema.safeParse({ sourceFactIds, annotation, verified: true }).success).toBe(false);
  });
  it("requires bounded source lines and complete typed employment", () => {
    const annotation = { kind: "EMPLOYMENT", employer: "Synthetic Company" };
    expect(sourceAnnotationSchema.safeParse({ sourceFactIds, annotation }).success).toBe(false);
    expect(sourceAnnotationSchema.safeParse({ sourceFactIds: [], annotation: { kind: "RESPONSIBILITY", activity: "Coordinated schedules", coverLetterEvidence: [] } }).success).toBe(false);
  });
  it("preserves uncertainty for a tool rather than upgrading capability", () => {
    expect(sourceAnnotationSchema.parse({ sourceFactIds, annotation: { kind: "TOOL_CAPABILITY", taskOrTool: "Excel", capabilityStatus: "UNSURE" } }).annotation).toMatchObject({ capabilityStatus: "UNSURE" });
  });
});
