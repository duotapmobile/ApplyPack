import { z } from "zod";
import { serviceErrorCanonicalJson } from "./service-error-contract";
import { SERVICE_REPAIR_SCOPE_VERSION, ServiceRepairContractError, serviceRepairAcceptedRowSchema,
  serviceRepairAcceptedScope, serviceRepairOriginalMemberSchema } from "./service-repair-contract";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const memberIdentity = serviceRepairOriginalMemberSchema.pick({ materialLineId: true, sourceSnapshotId: true,
  artifactId: true, fileVersionId: true, releaseId: true });
export const serviceRepairJobSchema = z.object({ id: uuid, case_id: uuid, customer_id: uuid, material_line_id: uuid,
  active_version_id: uuid.nullable(), lease_owner: uuid.nullable(), lease_token: uuid.nullable(),
  lease_generation: z.number().int().nonnegative(), lease_expires_at: time.nullable(), created_at: time }).strict();
export const serviceRepairVersionSchema = z.object({ id: uuid, request_id: uuid, job_id: uuid, case_id: uuid,
  customer_id: uuid, material_line_id: uuid, version: z.number().int().positive(), supersedes_id: uuid.nullable(),
  accepted_scope_sha256: hash, originals: z.array(serviceRepairOriginalMemberSchema).min(1).max(3), context_sha256: hash,
  encrypted_payload_id: uuid.nullable(), source_sha256: hash.nullable(), claim_review_encrypted_payload_id: uuid.nullable(),
  claim_review_sha256: hash.nullable(), claim_review_metadata: z.array(z.unknown()).max(3).nullable(),
  claims_reviewed_by: uuid.nullable(), claims_reviewed_at: time.nullable(), member_set_sha256: hash.nullable(),
  approval_sha256: hash.nullable(), review_checklist: z.record(z.string(), z.boolean()).nullable(),
  approved_by: uuid.nullable(), approved_at: time.nullable(), release_id: uuid.nullable(), invalidated_at: time.nullable(),
  created_by: uuid, created_at: time }).strict();
export type ServiceRepairVersion = z.infer<typeof serviceRepairVersionSchema>;
const latestRepairSchema = z.object({ originalFileVersionId: uuid, fileVersionId: uuid, releaseId: uuid, artifactId: uuid,
  artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), checksumSha256: hash, renderSourceSha256: hash, repairVersionId: uuid,
  sourcePayloadId: uuid, sourceSha256: hash, approvedAt: time, deliveredAt: time }).strict();
export const serviceRepairFeedbackSchema = z.object({ id: uuid, case_id: uuid, customer_id: uuid, material_line_id: uuid,
  repair_release_id: uuid, sensitive_payload_id: uuid, content_sha256: hash,
  members: z.array(z.object({ artifactId: uuid, fileVersionId: uuid }).strict()).min(1).max(3), created_at: time }).strict();
export const serviceRepairInspectionSchema = z.object({
  scope: z.object({ schemaVersion: z.literal(SERVICE_REPAIR_SCOPE_VERSION), caseId: uuid, customerId: uuid,
    members: z.array(memberIdentity).min(1).max(30), acceptedScopeSha256: hash }).strict(),
  acceptedRows: z.array(serviceRepairAcceptedRowSchema).min(1).max(3000),
  originals: z.array(serviceRepairOriginalMemberSchema).min(1).max(3), contextSha256: hash,
  job: serviceRepairJobSchema.nullable(), version: serviceRepairVersionSchema.nullable(),
  latestRepairs: z.array(latestRepairSchema).max(3), feedback: z.array(serviceRepairFeedbackSchema).max(3000),
}).strict();
export const serviceRepairOpenRequestSchema = z.object({ requestId: uuid, caseId: uuid, materialLineId: uuid,
  expectedVersionId: uuid.nullable(), acceptedScopeSha256: hash, contextSha256: hash }).strict();
export type ServiceRepairOpenRequest = z.infer<typeof serviceRepairOpenRequestSchema>;

function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceRepairContractError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code = "RECEIPT_INVALID"): T {
  const result = schema.safeParse(raw); ensure(result.success, code); return result.data;
}
const equal = (a: unknown, b: unknown) => serviceErrorCanonicalJson(a) === serviceErrorCanonicalJson(b);

/** This validates the complete authoritative union before selecting this line.
 * It does not make an expired original packet current or authorize a render. */
export function validateServiceRepairInspection(raw: unknown, expected: { caseId: string; materialLineId: string }) {
  const identity = parse(z.object({ caseId: uuid, materialLineId: uuid }).strict(), expected, "IDENTITY_INVALID");
  const value = parse(serviceRepairInspectionSchema, raw), scope = value.scope;
  ensure(scope.caseId === identity.caseId, "CASE_IDENTITY_MISMATCH");
  const normalized = serviceRepairAcceptedScope({ caseId: scope.caseId, customerId: scope.customerId }, value.acceptedRows);
  const computed = { schemaVersion: normalized.schemaVersion, caseId: normalized.caseId, customerId: normalized.customerId,
    members: normalized.members, acceptedScopeSha256: normalized.acceptedScopeSha256 };
  ensure(equal(computed, scope), "SCOPE_CHANGED");
  const selected = scope.members.filter((member) => member.materialLineId === identity.materialLineId);
  ensure(selected.length === value.originals.length && new Set(value.originals.map((member) => member.fileVersionId)).size === selected.length
    && value.originals.every((original) => selected.some((member) => Object.entries(member).every(([key, item]) => original[key as keyof typeof member] === item))), "MEMBERS_INCOMPLETE");
  ensure(new Set(value.latestRepairs.map((file) => file.originalFileVersionId)).size === value.latestRepairs.length
    && value.latestRepairs.every((file) => value.originals.some((original) => original.fileVersionId === file.originalFileVersionId
      && original.artifactId === file.artifactId && original.artifactType === file.artifactType && original.fileVersionId !== file.fileVersionId)
      && Date.parse(file.approvedAt) <= Date.parse(file.deliveredAt)), "LATEST_REPAIR_MISMATCH");
  ensure(new Set(value.feedback.map((feedback) => feedback.id)).size === value.feedback.length
    && value.feedback.every((feedback) => feedback.case_id === scope.caseId && feedback.customer_id === scope.customerId
      && feedback.material_line_id === identity.materialLineId
      && new Set(feedback.members.map((member) => member.fileVersionId)).size === feedback.members.length), "FEEDBACK_IDENTITY_MISMATCH");
  ensure(Boolean(value.job) === Boolean(value.version), "VERSION_IDENTITY_MISMATCH");
  if (value.job && value.version) {
    const job = value.job, version = value.version;
    ensure(job.case_id === scope.caseId && job.customer_id === scope.customerId && job.material_line_id === identity.materialLineId
      && job.active_version_id === version.id && version.job_id === job.id && version.case_id === scope.caseId
      && version.customer_id === scope.customerId && version.material_line_id === identity.materialLineId, "VERSION_IDENTITY_MISMATCH");
  }
  return value;
}

export type ServiceRepairOpenPort = {
  requireReviewer(reviewerId: string, signal: AbortSignal): Promise<unknown>;
  inspect(caseId: string, materialLineId: string, reviewerId: string, signal: AbortSignal): Promise<unknown>;
  readVersion(requestId: string, reviewerId: string, signal: AbortSignal): Promise<unknown | null>;
  open(request: ServiceRepairOpenRequest & { reviewerId: string }, signal: AbortSignal): Promise<unknown>;
};

function matchesRequest(raw: unknown, request: ServiceRepairOpenRequest, reviewerId: string) {
  const version = parse(serviceRepairVersionSchema, raw);
  ensure(version.request_id === request.requestId && version.case_id === request.caseId && version.material_line_id === request.materialLineId
    && version.supersedes_id === request.expectedVersionId && version.accepted_scope_sha256 === request.acceptedScopeSha256
    && version.context_sha256 === request.contextSha256 && version.created_by === reviewerId, "REQUEST_CONFLICT");
  return version;
}

/** A single owner-requested mutation, with read-only reconciliation. A historical
 * same-ID receipt is returned before currentness checks and never reacquires a
 * lease or dispatches generation. A later caller must revalidate current state. */
export async function openServiceRepair(port: ServiceRepairOpenPort, trustedReviewerId: string, raw: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  const reviewerId = parse(uuid, trustedReviewerId, "IDENTITY_INVALID"), request = parse(serviceRepairOpenRequestSchema, raw, "REQUEST_INVALID");
  const controller = new AbortController(), cancel = () => controller.abort();
  const timeout = options.timeoutMs ?? 20_000;
  ensure(Number.isInteger(timeout) && timeout > 0 && timeout <= 20_000, "TIMEOUT_INVALID");
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  let stopAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const stop = () => reject(new ServiceRepairContractError("UNCONFIRMED"));
    if (controller.signal.aborted) stop(); else controller.signal.addEventListener("abort", stop, { once: true });
    stopAbort = () => controller.signal.removeEventListener("abort", stop);
  });
  const timer = setTimeout(cancel, timeout), signal = controller.signal;
  const check = () => ensure(!signal.aborted, "UNCONFIRMED");
  try {
    return await Promise.race([(async () => {
      check(); parse(z.literal(true), await port.requireReviewer(reviewerId, signal), "REVIEWER_UNCONFIRMED"); check();
      const prior = await port.readVersion(request.requestId, reviewerId, signal); check();
      if (prior !== null) return { version: matchesRequest(prior, request, reviewerId), replayed: true,
        renderingAuthorized: false as const, deliveryAuthorized: false as const };
      const current = validateServiceRepairInspection(await port.inspect(request.caseId, request.materialLineId, reviewerId, signal),
        { caseId: request.caseId, materialLineId: request.materialLineId }); check();
      ensure(current.scope.acceptedScopeSha256 === request.acceptedScopeSha256 && current.contextSha256 === request.contextSha256
        && (current.version?.id ?? null) === request.expectedVersionId, "CONTEXT_CHANGED");
      let returned: unknown;
      try { returned = await port.open({ ...request, reviewerId }, signal); } catch { /* Exact readback resolves ambiguous commits. */ }
      check();
      const recorded = await port.readVersion(request.requestId, reviewerId, signal); check();
      ensure(recorded !== null, "UNCONFIRMED");
      const version = matchesRequest(recorded, request, reviewerId);
      ensure(version.customer_id === current.scope.customerId && equal(version.originals, current.originals)
        && (!current.job || version.job_id === current.job.id)
        && version.version === (current.version?.version ?? 0) + 1
        && (returned === undefined || returned === version.id), "RECEIPT_INVALID");
      return { version, replayed: false, renderingAuthorized: false as const, deliveryAuthorized: false as const };
    })(), aborted]);
  } catch (error) {
    if (error instanceof ServiceRepairContractError) throw error;
    throw new ServiceRepairContractError("UNCONFIRMED");
  } finally { clearTimeout(timer); stopAbort(); options.signal?.removeEventListener("abort", cancel); controller.abort(); }
}
