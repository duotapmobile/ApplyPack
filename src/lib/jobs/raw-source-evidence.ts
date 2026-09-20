import { createHash } from "node:crypto";

export type SourceEvidenceJson = null | boolean | number | string | SourceEvidenceJson[] | { [key: string]: SourceEvidenceJson };
export type RawSourceEvidence = { adapterVersion: string; payload: SourceEvidenceJson; payloadSha256: string };

// Preserve strings and array order exactly; sort object keys only. This binds a
// parsed provider record, not HTTP bytes, response headers, or credentials.
function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("raw_source_evidence_not_json");
}

export function captureRawSourceEvidence(adapterVersion: string, payload: unknown): RawSourceEvidence {
  if (!adapterVersion.trim()) throw new Error("raw_source_adapter_version_required");
  const serialized = stableJson(payload);
  return { adapterVersion, payload: JSON.parse(serialized) as SourceEvidenceJson,
    payloadSha256: createHash("sha256").update(serialized, "utf8").digest("hex") };
}

export function validRawSourceEvidence(evidence: RawSourceEvidence | undefined, adapterVersion: string): boolean {
  if (!evidence || evidence.adapterVersion !== adapterVersion || !/^[0-9a-f]{64}$/.test(evidence.payloadSha256)) return false;
  try { return captureRawSourceEvidence(adapterVersion, evidence.payload).payloadSha256 === evidence.payloadSha256; }
  catch { return false; }
}
