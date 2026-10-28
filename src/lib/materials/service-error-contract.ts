import { createHash } from "node:crypto";
import { z } from "zod";

export const SERVICE_ERROR_CONTRACT_VERSION = "service-error-only-v1" as const;
export const SERVICE_ERROR_TERMS_VERSION = "manual-launch-terms-2026-10-25-v4" as const;
export const SERVICE_ERROR_PRIVACY_VERSION = "privacy-2026-10-25-v4" as const;
export const SERVICE_ERROR_TIME_ZONE = "America/New_York" as const;
export const SERVICE_ERROR_REPORT_PURPOSE = "MATERIAL_SERVICE_ERROR_REPORT" as const;
export const SERVICE_ERROR_REVIEW_PURPOSE = "MATERIAL_SERVICE_ERROR_REVIEW" as const;

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const serviceErrorContractSchema = z.object({
  materialLineId: uuid, customerId: uuid, purchaseId: uuid, sourceSnapshotId: uuid,
  legalReceiptId: uuid, intakeReviewId: uuid, intakeReviewSha256: hash,
  contractVersion: z.literal(SERVICE_ERROR_CONTRACT_VERSION),
  termsVersion: z.literal(SERVICE_ERROR_TERMS_VERSION), termsContentSha256: hash,
  privacyVersion: z.literal(SERVICE_ERROR_PRIVACY_VERSION), privacyContentSha256: hash,
  confirmedIntakeVersion: z.literal("applypack-confirmed-intake-v1"),
  reportingTimeZone: z.literal(SERVICE_ERROR_TIME_ZONE), boundAt: time,
}).strict();
export type ServiceErrorContract = z.infer<typeof serviceErrorContractSchema>;

export const serviceErrorMemberSchema = z.object({ artifactId: uuid, fileVersionId: uuid, releaseId: uuid }).strict();
export const serviceErrorReportSchema = z.object({
  requestId: uuid, materialLineId: uuid,
  items: z.array(serviceErrorMemberSchema.extend({
    field: z.string().trim().min(1).max(100),
    documentText: z.string().trim().min(1).max(1500),
    expectedFact: z.string().trim().min(1).max(1500),
  }).strict()).min(1).max(3),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.fileVersionId)).size !== value.items.length) {
    context.addIssue({ code: "custom", message: "Group the details for each document in one item." });
  }
});
export type ServiceErrorReport = z.infer<typeof serviceErrorReportSchema>;

export const serviceErrorClassificationSchema = z.enum([
  "CONFIRMED_SERVICE_ERROR", "CUSTOMER_INPUT_CHANGE", "EDITORIAL_REQUEST", "HISTORICAL_REMEDY", "EVIDENCE_INVESTIGATION",
]);
export const serviceErrorEvidenceSchema = z.object({
  sourceSnapshotId: uuid, sourceFactIds: z.array(uuid).max(30), documentVersionIds: z.array(uuid).max(10),
  artifactId: uuid, fileVersionId: uuid, releaseId: uuid,
}).strict();
export const serviceErrorDecisionSchema = z.object({
  requestId: uuid, caseId: uuid, expectedDecisionId: uuid.nullable(),
  classification: serviceErrorClassificationSchema,
  reasonCode: z.enum(["CONFIRMED_SOURCE_MISMATCH", "UNSUPPORTED_GENERATED_CLAIM", "MATERIAL_MISREPRESENTATION",
    "CUSTOMER_CONFIRMED_VALUE", "NEW_OR_OMITTED_INFORMATION", "WORDING_OR_SELECTION_PREFERENCE",
    "HISTORICAL_CONTRACT", "CONFIRMATION_OR_PARSER_UNCLEAR", "EVIDENCE_MISSING"]),
  explanation: z.string().trim().min(10).max(6000),
  evidence: z.array(serviceErrorEvidenceSchema).min(1).max(30),
  affected: z.array(serviceErrorMemberSchema).max(30),
  confirmedValuesReviewed: z.literal(true), deliveredVersionReviewed: z.literal(true), parserProvenanceReviewed: z.literal(true),
}).strict().superRefine((value, context) => {
  const accepted = value.classification === "CONFIRMED_SERVICE_ERROR" || value.classification === "HISTORICAL_REMEDY";
  if (accepted !== (value.affected.length > 0)) context.addIssue({ code: "custom", message: "Only an accepted remedy has affected documents." });
  if (new Set(value.affected.map((item) => item.fileVersionId)).size !== value.affected.length) {
    context.addIssue({ code: "custom", message: "An affected document can be selected only once." });
  }
  if (value.affected.some((member) => !value.evidence.some((evidence) => evidence.artifactId === member.artifactId
    && evidence.fileVersionId === member.fileVersionId && evidence.releaseId === member.releaseId))) {
    context.addIssue({ code: "custom", message: "Every affected document needs its own reviewed evidence." });
  }
  const reasons: Record<z.infer<typeof serviceErrorClassificationSchema>, readonly string[]> = {
    CONFIRMED_SERVICE_ERROR: ["CONFIRMED_SOURCE_MISMATCH", "UNSUPPORTED_GENERATED_CLAIM", "MATERIAL_MISREPRESENTATION"],
    CUSTOMER_INPUT_CHANGE: ["CUSTOMER_CONFIRMED_VALUE", "NEW_OR_OMITTED_INFORMATION"],
    EDITORIAL_REQUEST: ["WORDING_OR_SELECTION_PREFERENCE"], HISTORICAL_REMEDY: ["HISTORICAL_CONTRACT"],
    EVIDENCE_INVESTIGATION: ["CONFIRMATION_OR_PARSER_UNCLEAR", "EVIDENCE_MISSING"],
  };
  if (!reasons[value.classification].includes(value.reasonCode)) context.addIssue({ code: "custom", message: "The decision and reason must agree." });
});
export type ServiceErrorDecision = z.infer<typeof serviceErrorDecisionSchema>;

export class ServiceErrorContractError extends Error {
  constructor(readonly code: string) { super(`SERVICE_ERROR_${code}`); this.name = "ServiceErrorContractError"; }
}
function requireThat(value: unknown, code: string): asserts value { if (!value) throw new ServiceErrorContractError(code); }

/** The absence of a prospective binding never changes an earlier purchase's remedy.
 * A v4 receipt without its immutable binding is inconsistent, not historical. */
export function resolveServiceErrorContract(input: {
  materialLineId: string; customerId: string; purchaseId: string; sourceSnapshotId: string;
  acceptedTermsVersion: string; acceptedPrivacyVersion: string; contract: unknown | null;
}) {
  const scope = z.object({ materialLineId: uuid, customerId: uuid, purchaseId: uuid, sourceSnapshotId: uuid,
    acceptedTermsVersion: z.string().min(1), acceptedPrivacyVersion: z.string().min(1), contract: z.unknown().nullable() }).strict().parse(input);
  if (scope.contract === null) {
    requireThat(scope.acceptedTermsVersion !== SERVICE_ERROR_TERMS_VERSION && scope.acceptedPrivacyVersion !== SERVICE_ERROR_PRIVACY_VERSION, "CONTRACT_BINDING_MISSING");
    return { kind: "HISTORICAL" as const, contract: null };
  }
  const parsed = serviceErrorContractSchema.safeParse(scope.contract); requireThat(parsed.success, "CONTRACT_INVALID");
  const contract = parsed.data;
  requireThat(contract.materialLineId === scope.materialLineId && contract.customerId === scope.customerId
    && contract.purchaseId === scope.purchaseId && contract.sourceSnapshotId === scope.sourceSnapshotId
    && contract.termsVersion === scope.acceptedTermsVersion && contract.privacyVersion === scope.acceptedPrivacyVersion, "CONTRACT_SCOPE_MISMATCH");
  return { kind: "SERVICE_ERROR_ONLY" as const, contract };
}

const localFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: SERVICE_ERROR_TIME_ZONE, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function localClock(epoch: number) {
  const parts = Object.fromEntries(localFormatter.formatToParts(epoch).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second),
    ((epoch % 1000) + 1000) % 1000);
}

/** Three local calendar days, preserving the delivery's wall-clock time. Like
 * PostgreSQL AT TIME ZONE, an ambiguous fall-back time uses standard time and
 * a nonexistent spring-forward time advances by the clock gap. The database
 * computes the authoritative stored deadline; this helper supplies matching UI. */
export function serviceErrorReportDeadline(deliveredAt: string): string {
  const parsed = time.safeParse(deliveredAt); requireThat(parsed.success, "DELIVERY_TIME_INVALID");
  const instant = Date.parse(parsed.data); requireThat(Number.isFinite(instant), "DELIVERY_TIME_INVALID");
  const wall = new Date(localClock(instant)); wall.setUTCDate(wall.getUTCDate() + 3);
  const target = wall.getTime(), offsets = new Set<number>();
  for (const shift of [-2, -1, 0, 1, 2]) {
    const probe = target + shift * 86_400_000; offsets.add(localClock(probe) - probe);
  }
  const candidates = [...offsets].map((offset) => target - offset), exact = candidates.filter((candidate) => localClock(candidate) === target);
  const selected = exact.length ? Math.max(...exact) : candidates.filter((candidate) => localClock(candidate) > target)
    .sort((left, right) => localClock(left) - localClock(right))[0];
  requireThat(selected !== undefined && Number.isFinite(selected), "DELIVERY_TIME_INVALID");
  return new Date(selected).toISOString();
}

/** Stable key order with exact string bytes; never use the prose in log keys. */
export function serviceErrorCanonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serviceErrorCanonicalJson).join(",")}]`;
  requireThat(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "JSON_INVALID");
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${serviceErrorCanonicalJson(object[key])}`).join(",")}}`;
}
export const serviceErrorSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function serviceErrorReportPayload(report: ServiceErrorReport) {
  return Buffer.from(serviceErrorCanonicalJson({ schemaVersion: "applypack-service-error-report-v1", ...serviceErrorReportSchema.parse(report) }), "utf8");
}
export function serviceErrorReviewPayload(decision: ServiceErrorDecision) {
  return Buffer.from(serviceErrorCanonicalJson({ schemaVersion: "applypack-service-error-review-v1", ...serviceErrorDecisionSchema.parse(decision) }), "utf8");
}
