import type { ServiceErrorDecision, ServiceErrorReport } from "./service-error-contract";

/** Browser receipt verification. Text stays in memory; no browser persistence. */
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Invalid receipt");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(canonical(value));
  try { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
  finally { bytes.fill(0); }
}
export async function matchesServiceErrorDecision(receipt: unknown, request: ServiceErrorDecision): Promise<boolean> {
  try {
    const saved = object(receipt); if (!saved) return false;
    return saved.requestId === request.requestId && saved.caseId === request.caseId && saved.previousDecisionId === request.expectedDecisionId
      && saved.classification === request.classification && saved.reasonCode === request.reasonCode
      && canonical(saved.evidence) === canonical(request.evidence) && canonical(saved.affected) === canonical(request.affected)
      && saved.reviewSha256 === await digest({ schemaVersion: "applypack-service-error-review-v1", ...request });
  } catch { return false; }
}
export async function matchesServiceErrorReport(receipt: unknown, request: ServiceErrorReport): Promise<boolean> {
  try {
    const saved = object(receipt); if (!saved) return false;
    return saved.requestId === request.requestId && saved.materialLineId === request.materialLineId
      && canonical(saved.members) === canonical(request.items.map(({ artifactId, fileVersionId, releaseId }) => ({ artifactId, fileVersionId, releaseId })))
      && saved.reportSha256 === await digest({ schemaVersion: "applypack-service-error-report-v1", ...request });
  } catch { return false; }
}
