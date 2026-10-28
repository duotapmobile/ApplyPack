import { z } from "zod";
import { draftingEvidenceExpectationSchema, DRAFTING_EVIDENCE_VERSION } from "@/lib/documents/drafting-evidence";
import { serviceErrorCanonicalJson, serviceErrorSha256 } from "./service-error-contract";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const SERVICE_REPAIR_SCOPE_VERSION = "applypack-service-error-accepted-scope-v1" as const;
export const SERVICE_REPAIR_PLAN_VERSION = "applypack-service-error-original-binding-v1" as const;

// A finite SELECT projection of immutable 096 rows. These must come from the
// authenticated database adapter, never from a customer report's requested facts.
export const serviceRepairAcceptedRowSchema = z.object({
  id: uuid, case_id: uuid, decision_id: uuid, customer_id: uuid, material_line_id: uuid,
  source_snapshot_id: uuid, artifact_id: uuid, file_version_id: uuid, release_id: uuid,
  member_kind: z.literal("ACCEPTED_ERROR"),
}).strict();
export type ServiceRepairAcceptedRow = z.infer<typeof serviceRepairAcceptedRowSchema>;
const scopeIdentitySchema = z.object({ caseId: uuid, customerId: uuid }).strict();
const memberIdentitySchema = z.object({ materialLineId: uuid, sourceSnapshotId: uuid,
  artifactId: uuid, fileVersionId: uuid, releaseId: uuid }).strict();
type MemberIdentity = z.infer<typeof memberIdentitySchema>;

export class ServiceRepairContractError extends Error {
  constructor(readonly code: string) { super(`SERVICE_REPAIR_${code}`); this.name = "ServiceRepairContractError"; }
}
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceRepairContractError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code: string): T {
  const value = schema.safeParse(raw); ensure(value.success, code); return value.data;
}
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const digest = (value: unknown) => serviceErrorSha256(Buffer.from(serviceErrorCanonicalJson(value), "utf8"));

/** Produces a deterministic union, not proof that the database query was complete.
 * A connected caller must compare this digest with the current authoritative
 * case scope and recheck that authority before every mutation. Repeated accepted
 * decisions preserve provenance without creating another repair entitlement. */
export function serviceRepairAcceptedScope(identityRaw: { caseId: string; customerId: string }, rowsRaw: unknown) {
  const identity = parse(scopeIdentitySchema, identityRaw, "SCOPE_INVALID");
  // This is an execution bound, not a policy limit. An oversized history is held;
  // no pagination/truncation may be presented as the complete accepted union.
  const rows = parse(z.array(serviceRepairAcceptedRowSchema).min(1).max(3000), rowsRaw, "SCOPE_INVALID");
  ensure(new Set(rows.map((row) => row.id)).size === rows.length, "SCOPE_DUPLICATE");
  ensure(new Set(rows.map((row) => `${row.decision_id}:${row.file_version_id}`)).size === rows.length, "SCOPE_DUPLICATE");
  const members = new Map<string, { identity: MemberIdentity; acceptances: { affectedMemberId: string; decisionId: string }[] }>();
  for (const row of rows) {
    ensure(row.case_id === identity.caseId && row.customer_id === identity.customerId, "SCOPE_OWNER_MISMATCH");
    const member = { materialLineId: row.material_line_id, sourceSnapshotId: row.source_snapshot_id,
      artifactId: row.artifact_id, fileVersionId: row.file_version_id, releaseId: row.release_id };
    const previous = members.get(member.fileVersionId);
    ensure(!previous || serviceErrorCanonicalJson(previous.identity) === serviceErrorCanonicalJson(member), "SCOPE_MEMBER_CONFLICT");
    if (!previous) members.set(member.fileVersionId, { identity: member, acceptances: [] });
    members.get(member.fileVersionId)!.acceptances.push({ affectedMemberId: row.id, decisionId: row.decision_id });
  }
  ensure(members.size <= 30, "SCOPE_TOO_LARGE");
  const normalized = [...members.values()].sort((a, b) => compare(a.identity.fileVersionId, b.identity.fileVersionId));
  const scope = { schemaVersion: SERVICE_REPAIR_SCOPE_VERSION, ...identity, members: normalized.map((member) => member.identity) };
  return { ...scope, acceptedScopeSha256: digest(scope), acceptances: normalized.map((member) => ({
    fileVersionId: member.identity.fileVersionId,
    records: member.acceptances.sort((a, b) => compare(a.affectedMemberId, b.affectedMemberId)),
  })) };
}

export const serviceRepairOriginalMemberSchema = memberIdentitySchema.extend({
  artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), checksumSha256: hash,
  draftVersionId: uuid, draftJobId: uuid, packetPayloadId: uuid, packetSha256: hash,
  sourcePayloadId: uuid, sourceSha256: hash, revisionId: uuid, revisionVersion: z.number().int().positive(),
  bindingSha256: hash, approvedAt: time, deliveredAt: time,
}).strict();
export type ServiceRepairOriginalMember = z.infer<typeof serviceRepairOriginalMemberSchema>;
const packetProjection = z.object({ schemaVersion: z.literal(DRAFTING_EVIDENCE_VERSION),
  expected: draftingEvidenceExpectationSchema, validUntil: time,
  binding: z.object({ snapshotId: uuid, contactPayloadId: uuid, contactSha256: hash }).passthrough(),
}).passthrough();
const claimProjection = z.object({ claimId: uuid, placement: z.string().min(1).max(180),
  text: z.string().min(1).max(3000), wordingSha256: hash }).passthrough();
const sourceProjection = z.object({ schemaVersion: z.literal("applypack-draft-render-source-v1"),
  expected: draftingEvidenceExpectationSchema, packetSha256: hash, contactPayloadId: uuid, contactSha256: hash,
  finalVersionAt: time, validUntil: time, ownerReviewClaims: z.array(claimProjection).min(1).max(250),
}).passthrough();

function decodeOriginal(bytes: Buffer, sha256: string, maximum: number): unknown {
  ensure(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum, "ORIGINAL_BYTES_INVALID");
  ensure(serviceErrorSha256(bytes) === sha256, "ORIGINAL_HASH_MISMATCH");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), value: unknown = JSON.parse(text);
    ensure(serviceErrorCanonicalJson(value) === text, "ORIGINAL_BYTES_INVALID"); return value;
  } catch (error) {
    if (error instanceof ServiceRepairContractError) throw error;
    throw new ServiceRepairContractError("ORIGINAL_BYTES_INVALID");
  }
}

/** Binds historical bytes only. It deliberately does not call a paid/current
 * drafting validator with a backdated clock, refresh an old packet, or return
 * private prose as executable renderer input. Repair authorization, a corrected
 * source, factual QA, owner approval and replacement delivery are separate gates.
 * The caller owns the supplied plaintext buffers and must clear them afterward. */
export function bindServiceRepairOriginals(input: {
  caseId: string; customerId: string; materialLineId: string; acceptedScopeSha256: string;
  acceptedRows: unknown;
  originals: { member: unknown; packetBytes: Buffer; sourceBytes: Buffer }[];
}, now = new Date()) {
  const expected = parse(z.object({ caseId: uuid, customerId: uuid, materialLineId: uuid, acceptedScopeSha256: hash }).strict(),
    { caseId: input.caseId, customerId: input.customerId, materialLineId: input.materialLineId, acceptedScopeSha256: input.acceptedScopeSha256 }, "SCOPE_INVALID");
  const clock = now.getTime(); ensure(Number.isFinite(clock), "CLOCK_INVALID");
  const scope = serviceRepairAcceptedScope({ caseId: expected.caseId, customerId: expected.customerId }, input.acceptedRows);
  ensure(scope.acceptedScopeSha256 === expected.acceptedScopeSha256, "SCOPE_CHANGED");
  const selected = scope.members.filter((member) => member.materialLineId === expected.materialLineId);
  ensure(selected.length > 0 && Array.isArray(input.originals) && input.originals.length === selected.length, "MEMBERS_INCOMPLETE");
  const bound = input.originals.map((original) => {
    const member = parse(serviceRepairOriginalMemberSchema, original.member, "ORIGINAL_MEMBER_INVALID");
    const accepted = selected.find((entry) => entry.fileVersionId === member.fileVersionId);
    ensure(accepted && Object.entries(accepted).every(([key, value]) => member[key as keyof MemberIdentity] === value), "MEMBER_NOT_ACCEPTED");
    const packet = parse(packetProjection, decodeOriginal(original.packetBytes, member.packetSha256, 2_000_000), "ORIGINAL_PACKET_INVALID");
    const source = parse(sourceProjection, decodeOriginal(original.sourceBytes, member.sourceSha256, 2_000_000), "ORIGINAL_SOURCE_INVALID");
    const expectation = { customerId: expected.customerId, materialLineId: expected.materialLineId,
      revisionId: member.revisionId, revisionVersion: member.revisionVersion, bindingSha256: member.bindingSha256 };
    ensure(serviceErrorCanonicalJson(packet.expected) === serviceErrorCanonicalJson(expectation)
      && serviceErrorCanonicalJson(source.expected) === serviceErrorCanonicalJson(expectation)
      && packet.binding.snapshotId === member.sourceSnapshotId && source.packetSha256 === member.packetSha256
      && source.contactPayloadId === packet.binding.contactPayloadId && source.contactSha256 === packet.binding.contactSha256
      && source.validUntil === packet.validUntil, "ORIGINAL_BINDING_MISMATCH");
    ensure(Date.parse(source.finalVersionAt) <= Date.parse(member.approvedAt)
      && Date.parse(member.approvedAt) <= Date.parse(member.deliveredAt) && Date.parse(member.deliveredAt) <= clock, "ORIGINAL_TIMELINE_INVALID");
    ensure(new Set(source.ownerReviewClaims.map((claim) => claim.claimId)).size === source.ownerReviewClaims.length
      && source.ownerReviewClaims.every((claim) => serviceErrorSha256(Buffer.from(claim.text, "utf8")) === claim.wordingSha256), "ORIGINAL_CLAIMS_INVALID");
    const prefix = member.artifactType === "RESUME" ? "resume." : member.artifactType === "COVER_LETTER" ? "coverLetter." : "referenceSheet.";
    const claims = source.ownerReviewClaims.filter((claim) => claim.placement.startsWith(prefix));
    ensure(claims.length > 0, "ORIGINAL_ARTIFACT_MISSING");
    return { ...member, originalEvidenceValidUntil: packet.validUntil,
      contactPayloadId: packet.binding.contactPayloadId, contactSha256: packet.binding.contactSha256,
      originalClaimIds: claims.map((claim) => claim.claimId),
      acceptances: scope.acceptances.find((entry) => entry.fileVersionId === member.fileVersionId)!.records };
  }).sort((left, right) => compare(left.fileVersionId, right.fileVersionId));
  ensure(new Set(bound.map((member) => member.fileVersionId)).size === selected.length, "MEMBERS_INCOMPLETE");
  // One saved source cannot have conflicting payload identities just because its
  // two artifacts were loaded independently. Distinct historical sources remain
  // separate members; this boundary never chooses which one to replace silently.
  const versions = new Map<string, string>();
  for (const member of bound) {
    const identity = serviceErrorCanonicalJson({ job: member.draftJobId, packet: member.packetPayloadId, packetSha256: member.packetSha256,
      source: member.sourcePayloadId, sourceSha256: member.sourceSha256, revision: member.revisionId });
    ensure(!versions.has(member.draftVersionId) || versions.get(member.draftVersionId) === identity, "ORIGINAL_VERSION_CONFLICT");
    versions.set(member.draftVersionId, identity);
  }
  const body = { schemaVersion: SERVICE_REPAIR_PLAN_VERSION, ...expected, members: bound,
    state: "OWNER_REVIEW_REQUIRED" as const, renderingAuthorized: false as const, approvalAuthorized: false as const,
    deliveryAuthorized: false as const, paidDeadlineChanged: false as const, accessRefreshed: false as const };
  return { ...body, originalBindingSha256: digest(body) };
}
