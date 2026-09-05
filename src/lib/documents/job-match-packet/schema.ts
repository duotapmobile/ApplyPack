import { z } from "zod";
import { JOB_EVIDENCE_FIELDS, packetEvidenceId, type PacketEvidenceGroup } from "./evidence";
import { JOB_MATCH_PACKET_SCHEMA_VERSION } from "./versions";

const MAX_TEXT = 4_000;
const unsafeControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu;

export function inertDocumentText(value: string): string {
  return value.normalize("NFC").replace(unsafeControls, "").replace(/\r\n?/gu, "\n").trim();
}

const text = (maximum = MAX_TEXT) => z.string().transform(inertDocumentText).pipe(z.string().min(1).max(maximum));
const optionalText = (maximum = MAX_TEXT) => z.string().transform(inertDocumentText).pipe(z.string().max(maximum)).optional();
const utcTimestamp = z.string().datetime({ offset: true });
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const sourceEvidenceId = z.string().regex(new RegExp(`^(candidate-fact:${uuidPattern}|job:${uuidPattern}:(${JOB_EVIDENCE_FIELDS.join("|")}))$`, "u"));
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "An HTTPS application URL is required.");
const sourceEvidenceInputId = z.string().regex(new RegExp(`^(candidate-fact:${uuidPattern}|job-field:(${JOB_EVIDENCE_FIELDS.join("|")}))$`, "u"));
const id = text(200);

export const evidenceStatementSchema = z.object({
  claimId: id,
  kind: z.enum(["DIRECT", "TRANSFERABLE", "GAP", "SOFT_PREFERENCE_COMPROMISE"]),
  statement: text(1_500),
  evidenceIds: z.array(sourceEvidenceId).min(1).max(50),
}).strict();

export const unknownWarningSchema = z.object({
  claimId: id,
  field: text(120),
  status: z.enum(["NOT_CONFIRMED", "NOT_STATED", "UNKNOWN"]),
  evidenceIds: z.array(sourceEvidenceId).min(1).max(50),
}).strict();

export const evidenceStatementInputSchema = evidenceStatementSchema.omit({ claimId: true, evidenceIds: true }).extend({
  evidenceIds: z.array(sourceEvidenceInputId).min(1).max(50),
}).strict();
export const unknownWarningInputSchema = unknownWarningSchema.omit({ claimId: true, evidenceIds: true }).extend({
  evidenceIds: z.array(sourceEvidenceInputId).min(1).max(50),
}).strict();

export const jobMatchPacketEntrySchema = z.object({
  jobId: id,
  approval: z.object({
    disposition: z.literal("APPROVED"),
    reviewId: id,
    reviewerId: id,
    reviewedAt: utcTimestamp,
  }).strict(),
  eligibilityDisposition: z.enum(["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"]),
  nonNegotiableDisposition: z.literal("PASS"),
  positionTitle: text(500),
  employerName: text(500),
  locationDisplay: text(500),
  workArrangement: optionalText(200),
  employmentType: optionalText(200),
  compensationDisplay: optionalText(500),
  benefitsDisplay: optionalText(500),
  travelRequirements: optionalText(500),
  scheduleDisplay: optionalText(500),
  geographicEligibility: optionalText(500),
  directApplicationUrl: httpsUrl,
  sourceDisplay: text(500),
  verifiedAt: utcTimestamp,
  matchCategory: z.enum(["DIRECT", "TRANSFERABLE", "DIRECT_AND_TRANSFERABLE"]),
  whyMatched: text(2_000),
  strongConnections: z.array(evidenceStatementSchema).min(1).max(30),
  thingsToConsider: z.array(evidenceStatementSchema).max(30),
  unknownWarnings: z.array(unknownWarningSchema).max(30),
}).strict().superRefine((job, context) => {
  const warnings = new Set(job.unknownWarnings.map((warning) => warning.field.toLocaleLowerCase("en-US")));
  const governedUnknowns: Array<[string | undefined, string]> = [
    [job.workArrangement, "Work arrangement"],
    [job.employmentType, "Employment classification"],
    [job.compensationDisplay, "Compensation"],
    [job.benefitsDisplay, "Health benefits"],
    [job.travelRequirements, "Travel requirements"],
    [job.scheduleDisplay, "Schedule requirements"],
    [job.geographicEligibility, "Geographic eligibility"],
  ];
  for (const [value, label] of governedUnknowns) {
    if (!value && !warnings.has(label.toLocaleLowerCase("en-US"))) {
      context.addIssue({ code: "custom", path: ["unknownWarnings"], message: `${label} must be stated or preserved as an explicit unknown.` });
    }
  }
  checkEvidenceReferences(job.jobId, "strong", job.strongConnections, context);
  checkEvidenceReferences(job.jobId, "consideration", job.thingsToConsider, context);
  checkEvidenceReferences(job.jobId, "unknown", job.unknownWarnings, context);
});

function checkEvidenceReferences(jobId: string, group: PacketEvidenceGroup, values: Array<{ claimId: string; evidenceIds: string[] }>, context: z.RefinementCtx) {
  values.forEach((value, index) => {
    const expected = packetEvidenceId(jobId, group, index);
    if (value.claimId !== expected) {
      context.addIssue({ code: "custom", path: [group, index, "claimId"], message: "The packet claim must resolve to this approved job-match record." });
    }
  });
}

export const jobMatchPacketContentSchema = z.object({
  schemaVersion: z.literal(JOB_MATCH_PACKET_SCHEMA_VERSION),
  orderId: id,
  customerId: id,
  customerDisplayName: text(300),
  generatedAt: utcTimestamp,
  policyVersions: z.record(z.string(), text(200)).refine((value) => Object.keys(value).length > 0, "Policy versions are required."),
  jobs: z.array(jobMatchPacketEntrySchema).length(10),
  disclosures: z.array(text(1_000)).min(1).max(10),
}).strict().superRefine((packet, context) => {
  if (new Set(packet.jobs.map((job) => job.jobId)).size !== packet.jobs.length) {
    context.addIssue({ code: "custom", path: ["jobs"], message: "The final packet must contain 10 distinct approved jobs." });
  }
});

export type EvidenceStatement = z.infer<typeof evidenceStatementSchema>;
export type UnknownWarning = z.infer<typeof unknownWarningSchema>;
export type JobMatchPacketEntry = z.infer<typeof jobMatchPacketEntrySchema>;
export type JobMatchPacketContent = z.infer<typeof jobMatchPacketContentSchema>;

export function parseFinalJobMatchPacketContent(input: unknown): JobMatchPacketContent {
  return jobMatchPacketContentSchema.parse(input);
}
