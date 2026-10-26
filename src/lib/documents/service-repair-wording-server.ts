import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";
import { boundedServiceErrorIo } from "@/lib/materials/service-error-payload";
import { serviceErrorCanonicalJson } from "@/lib/materials/service-error-contract";
import { readServiceRepairPayload, storeServiceRepairPayload } from "@/lib/materials/service-repair-payload";
import { serviceRepairVersionSchema, validateServiceRepairInspection, type ServiceRepairVersion } from "@/lib/materials/service-repair-workflow";
import { materialContactSchema } from "@/lib/materials/server";
import { repairWordingExpectedSchema, repairWordingIdentitySchema, repairWordingRequestSchema, readRepairWordingView,
  type RepairWordingRequest, type RepairWordingResult } from "@/lib/materials/service-repair-wording";
import { loadServiceRepairOriginalEvidence } from "./service-repair-render-server";
import { readServiceRepairSourceForReview, selectedServiceRepairClaims, serviceRepairClaimReviewMetadata,
  type ServiceRepairReviewMember } from "./service-repair-source";
import { readConfirmedDraftContact } from "./draft-owner-contact";
import { readServiceRepairReviewReferences } from "./draft-owner-references";
import { readDraftReferenceSources, validateDraftReferenceSource, type DraftReferenceInput } from "./draft-reference-source";

const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const same = (a: unknown, b: unknown) => serviceErrorCanonicalJson(a) === serviceErrorCanonicalJson(b);
type Identity = z.infer<typeof repairWordingIdentitySchema>;
type Loaded = Awaited<ReturnType<typeof loadServiceRepairOriginalEvidence>>;
export class ServiceRepairWordingError extends Error {
  constructor(readonly code: "INVALID" | "CHANGED" | "UNCONFIRMED" | "TOO_LARGE") { super(`SERVICE_REPAIR_WORDING_${code}`); }
}
function ensure(value: unknown, code: ServiceRepairWordingError["code"] = "UNCONFIRMED"): asserts value { if (!value) throw new ServiceRepairWordingError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const value = schema.safeParse(raw); ensure(value.success, "INVALID"); return value.data; }
function clean(value: Loaded | undefined) { value?.originals.forEach(entry => { entry.packetBytes.fill(0); entry.sourceBytes.fill(0); }); }
function expected(identity: Identity, read: ReturnType<typeof readServiceRepairSourceForReview>) {
  return parse(repairWordingExpectedSchema, { ...identity, sourceSha256: read.sourceSha256, contextSha256: read.contextSha256,
    acceptedScopeSha256: read.acceptedScopeSha256, members: read.members.map(member => ({ originalFileVersionId: member.original.fileVersionId,
      renderSourceSha256: member.source.renderSourceSha256, claims: selectedServiceRepairClaims(member.source, member.artifactType)
        .map(({ claimId, wordingSha256 }) => ({ claimId, wordingSha256 })) })) });
}
function decisions(request: RepairWordingRequest) {
  const required = request.expected.members.flatMap(member => member.claims.map(claim => ({ originalFileVersionId: member.originalFileVersionId,
    ...claim, decision: "APPROVED" as const })));
  ensure(same(required, request.decisions), "INVALID");
  ensure(new Set(request.expected.members.map(member => member.originalFileVersionId)).size === request.expected.members.length
    && request.expected.members.every(member => new Set(member.claims.map(claim => claim.claimId)).size === member.claims.length), "INVALID");
}

/** Called only behind fresh owner MFA. Read/review does not claim a worker lease,
 * render, approve files or send. Uncertain writes are reconciled by exact IDs. */
export function createServiceRepairWordingServer(admin: SupabaseClient<Database>, trustedReviewerId: string, options: { now?: () => Date } = {}) {
  const reviewerId = parse(z.uuid(), trustedReviewerId), now = options.now ?? (() => new Date());
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted); const result = await query; ensure(!signal.aborted && !result.error); return result.data;
  }
  const run = <T,>(signal: AbortSignal, action: (child: AbortSignal) => Promise<T>) => boundedServiceErrorIo(signal, async child => {
    try {
      ensure(await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(child), child) === true);
      return await action(child);
    } catch (error) { throw error instanceof ServiceRepairWordingError ? error : new ServiceRepairWordingError("UNCONFIRMED"); }
  }, 60_000);
  async function inspect(identity: Identity, signal: AbortSignal) {
    return validateServiceRepairInspection(await data(admin.rpc("ap_inspect_service_repair", { p_case_id: identity.caseId,
      p_material_line_id: identity.materialLineId, p_reviewer_id: reviewerId }).abortSignal(signal), signal),
    { caseId: identity.caseId, materialLineId: identity.materialLineId });
  }
  async function version(request: RepairWordingRequest, signal: AbortSignal) {
    const v = parse(serviceRepairVersionSchema, await data(admin.from("ap_service_repair_versions").select("*")
      .eq("id", request.expected.versionId).abortSignal(signal).single(), signal)), e = request.expected;
    ensure(v.id === e.versionId && v.case_id === e.caseId && v.material_line_id === e.materialLineId
      && v.source_sha256 === e.sourceSha256 && v.context_sha256 === e.contextSha256 && v.accepted_scope_sha256 === e.acceptedScopeSha256, "CHANGED"); return v;
  }
  function payload(v: ServiceRepairVersion, payloadId: string, sha256: string, purpose: "SERVICE_REPAIR_SOURCE" | "SERVICE_REPAIR_CLAIM_REVIEW") {
    return { customerId: v.customer_id, caseId: v.case_id, repairVersionId: v.id, payloadId, sha256, purpose };
  }
  async function recorded(request: RepairWordingRequest, signal: AbortSignal): Promise<RepairWordingResult> {
    const v = await version(request, signal), common = { requestId: request.requestId, expected: request.expected,
      renderingAuthorized: false as const, deliveryAuthorized: false as const };
    if (!v.claim_review_encrypted_payload_id) {
      ensure(!v.claim_review_sha256 && !v.claim_review_metadata && !v.claims_reviewed_by && !v.claims_reviewed_at, "CHANGED");
      return { ...common, status: "ABSENT", reviewSha256: null };
    }
    ensure(v.claim_review_encrypted_payload_id === request.requestId && v.claim_review_sha256 && v.claim_review_metadata
      && v.claims_reviewed_by === reviewerId && v.claims_reviewed_at, "CHANGED");
    let bytes: Buffer | undefined;
    try {
      bytes = await readServiceRepairPayload(admin, payload(v, request.requestId, v.claim_review_sha256, "SERVICE_REPAIR_CLAIM_REVIEW"), { signal });
      ensure(!signal.aborted); const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const saved = parse(z.object({ schemaVersion: z.literal("applypack-service-repair-wording-review-v1"), reviewerId: z.uuid(),
        request: repairWordingRequestSchema, members: z.array(z.unknown()).min(1).max(3), wording: z.array(z.unknown()).min(1).max(3) }).strict(), JSON.parse(body));
      ensure(serviceErrorCanonicalJson(saved) === body && hash(bytes) === v.claim_review_sha256 && saved.reviewerId === reviewerId
        && same(saved.request, request) && same(saved.members, v.claim_review_metadata), "CHANGED");
      return { ...common, status: "RECORDED", reviewSha256: v.claim_review_sha256 };
    } finally { bytes?.fill(0); }
  }
  async function memberView(member: ServiceRepairReviewMember, signal: AbortSignal) {
    let contact: Buffer | undefined; let references: DraftReferenceInput[] = [];
    try {
      contact = await readConfirmedDraftContact(admin, { customerId: member.packet.expected.customerId,
        payloadId: member.packet.binding.contactPayloadId, sha256: member.packet.binding.contactSha256 }, signal);
      ensure(!signal.aborted); const confirmed = materialContactSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contact)));
      if (member.artifactType === "REFERENCE_SHEET") {
        references = await readServiceRepairReviewReferences(admin, member, signal, { now }); ensure(!signal.aborted);
        validateDraftReferenceSource(member.source.referenceSheet, member.packet.ownerEvidence.referenceBindings, references, now());
      }
      const refs = references.length ? readDraftReferenceSources(member.packet.ownerEvidence.referenceBindings!, references, now()) : [];
      return { originalFileVersionId: member.original.fileVersionId, artifactType: member.artifactType,
        claims: selectedServiceRepairClaims(member.source, member.artifactType).map(claim => ({ claimId: claim.claimId, wordingSha256: claim.wordingSha256,
          placement: claim.placement, text: claim.text, qualification: claim.qualification,
          sources: claim.contactBinding ? claim.contactBinding.fields.map(field => {
            ensure(claim.origin === "LOCAL_CONTACT" && claim.contactBinding?.fields.length === 1
              && claim.contactBinding.payloadId === member.packet.binding.contactPayloadId && claim.contactBinding.contentSha256 === member.packet.binding.contactSha256
              && ["displayName", "email", "phone", "cityState", "linkedInOrPortfolio"].includes(field), "CHANGED");
            const value = confirmed[field as keyof typeof confirmed]; ensure(typeof value === "string" && value === claim.text, "CHANGED");
            return { label: `Confirmed checkout ${field}`, value };
          }) : claim.referenceBinding ? (() => {
            const reference = refs.find(ref => ref.binding.permissionId === claim.referenceBinding?.permissionId);
            const field = reference?.fields.find(value => value.field === claim.referenceBinding?.field);
            ensure(field && claim.origin === "LOCAL_REFERENCE" && field.value === claim.text, "CHANGED");
            return [{ label: `Confirmed reference ${field.field}`, value: field.value }];
          })() : claim.factRefs.flatMap(ref => {
            const fact = member.packet.ownerEvidence.facts.find(value => value.id === ref.factId);
            const value = ref.field.split(".").reduce<unknown>((parent, key) => parent && typeof parent === "object" ? (parent as Record<string, unknown>)[key] : undefined, fact?.typed_value);
            ensure(fact && value !== undefined && hash(JSON.stringify(value)) === ref.valueSha256, "CHANGED");
            const sources = [{ label: `${fact.customer_display_label || fact.value_kind} · ${ref.field}`, value: typeof value === "string" ? value : JSON.stringify(value) }];
            if (fact.capability_status) sources.push({ label: "Confirmed capability status", value: fact.capability_status });
            if (fact.typed_value && typeof fact.typed_value === "object" && !Array.isArray(fact.typed_value)) {
              const fields = fact.typed_value as Record<string, unknown>;
              for (const key of ["status", "capabilityStatus", "completionStatus", "credentialState"]) {
                if (typeof fields[key] === "string") sources.push({ label: `Confirmed limitation · ${key}`, value: fields[key] as string });
              }
            }
            if (ref.attributionFactId) {
              const parent = member.packet.ownerEvidence.facts.find(item => item.id === ref.attributionFactId);
              ensure(parent && parent.typed_value && typeof parent.typed_value === "object" && !Array.isArray(parent.typed_value), "CHANGED");
              const fields = parent.typed_value as Record<string, unknown>;
              for (const key of ["employer", "employerOrOrganization", "organizationOrProject", "historicalTitle", "roleOrRelationship", "dates", "startsOn", "endsOn", "datePrecision", "current"]) {
                const field = fields[key]; if (typeof field === "string" || typeof field === "boolean") sources.push({ label: `Attributed experience · ${key}`, value: String(field) });
              }
            }
            return sources;
          }),
          jobEvidence: claim.jobEvidenceIds.map(id => { const item = member.packet.ownerEvidence.requirements.find(value => value.id === id); ensure(item, "CHANGED"); return item.source_excerpt; }),
          questions: claim.questionInsights.map(item => { const q = member.packet.employerQuestionInsights.questions.find(value => value.id === item.questionId); ensure(q, "CHANGED"); return { id: q.id, prompt: q.prompt }; }) })) };
    } finally { contact?.fill(0); references.forEach(value => value.plaintext.fill(0)); }
  }
  async function load(identity: Identity, signal: AbortSignal) {
    let loaded: Loaded | undefined, bytes: Buffer | undefined;
    try {
      loaded = await loadServiceRepairOriginalEvidence(admin, reviewerId, identity, signal, { now }); ensure(!signal.aborted);
      const v = loaded.inspection.version!; ensure(v.encrypted_payload_id && v.source_sha256, "CHANGED");
      bytes = await readServiceRepairPayload(admin, payload(v, v.encrypted_payload_id, v.source_sha256, "SERVICE_REPAIR_SOURCE"), { signal }); ensure(!signal.aborted);
      const read = readServiceRepairSourceForReview({ ...identity, inspection: loaded.inspection, originals: loaded.originals, envelopeBytes: bytes }, now());
      ensure(read.members.every(member => selectedServiceRepairClaims(member.source, member.artifactType).length <= 250), "TOO_LARGE");
      const members = []; for (const member of read.members) members.push(await memberView(member, signal));
      ensure(!signal.aborted && same(await inspect(identity, signal), loaded.inspection), "CHANGED");
      return { inspection: loaded.inspection, version: v, read, view: readRepairWordingView({ expected: expected(identity, read), reviewed: Boolean(v.claim_review_sha256),
        members, renderingAuthorized: false, deliveryAuthorized: false }, identity) };
    } finally { clean(loaded); bytes?.fill(0); }
  }
  return {
    read: (raw: unknown, signal: AbortSignal) => run(signal, async child => (await load(parse(repairWordingIdentitySchema, raw), child)).view),
    act: (raw: unknown, checkOnly: boolean, signal: AbortSignal) => run(signal, async child => {
      const request = parse(repairWordingRequestSchema, raw); decisions(request);
      const prior = await recorded(request, child); if (checkOnly || prior.status === "RECORDED") return prior;
      const identity = parse(repairWordingIdentitySchema, { caseId: request.expected.caseId, materialLineId: request.expected.materialLineId, versionId: request.expected.versionId });
      const loaded = await load(identity, child); ensure(same(loaded.view.expected, request.expected), "CHANGED");
      ensure(!loaded.version.member_set_sha256 && !loaded.version.approval_sha256, "CHANGED");
      const members = loaded.read.members.map(member => ({ originalFileVersionId: member.original.fileVersionId, renderSourceSha256: member.source.renderSourceSha256,
        claims: selectedServiceRepairClaims(member.source, member.artifactType).map(serviceRepairClaimReviewMetadata) }));
      const bytes = Buffer.from(serviceErrorCanonicalJson({ schemaVersion: "applypack-service-repair-wording-review-v1", reviewerId, request,
        members, wording: loaded.view.members.map(member => ({ originalFileVersionId: member.originalFileVersionId,
          claims: member.claims.map(({ claimId, text, wordingSha256 }) => ({ claimId, text, wordingSha256 })) })) }));
      try {
        // Pretty JSON is a conservative upper bound for this string-only metadata's
        // PostgreSQL jsonb text spacing; do not undercount the SQL 600000-byte cap.
        ensure(bytes.length <= 1_000_000 && Buffer.byteLength(JSON.stringify(members, null, 2)) <= 600_000, "TOO_LARGE"); const reviewSha256 = hash(bytes);
        await storeServiceRepairPayload(admin, payload(loaded.version, request.requestId, reviewSha256, "SERVICE_REPAIR_CLAIM_REVIEW"), bytes, { signal: child });
        ensure(!child.aborted && same(await inspect(identity, child), loaded.inspection), "CHANGED");
        let returned: unknown;
        try { returned = await data(admin.rpc("ap_review_service_repair_wording", { p_version_id: identity.versionId, p_source_sha256: request.expected.sourceSha256,
          p_payload_id: request.requestId, p_review_sha256: reviewSha256, p_members: members as Json, p_reviewer_id: reviewerId }).abortSignal(child), child); }
        catch { /* Read the immutable exact request receipt; never repeat the mutation. */ }
        ensure(!child.aborted); const receipt = await recorded(request, child);
        ensure(receipt.status === "RECORDED" && receipt.reviewSha256 === reviewSha256 && (returned === undefined || returned === reviewSha256)); return receipt;
      } finally { bytes.fill(0); }
    }),
  };
}
