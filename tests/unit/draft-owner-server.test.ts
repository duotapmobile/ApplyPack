import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANONICALIZATION_VERSION, canonicalSha256 } from "@/lib/domain/foundation";
import { buildFourStepSnapshot, emptyFourStepDraft, normalizedFourStepDraft } from "@/lib/intake/four-step";
import { buildDraftingEvidencePacket, type DraftingEvidenceRecords } from "@/lib/documents/drafting-evidence";
import { validateDraftOutput, type DraftOutput, type DraftProseClaim } from "@/lib/documents/draft-output";
import { buildDraftRenderSource } from "@/lib/documents/draft-render-source";
import { captureRawSourceEvidence } from "@/lib/jobs/raw-source-evidence";
import { questionResponseSha256 } from "@/lib/jobs/application-question-evidence";

vi.mock("server-only", () => ({}));
const id = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const before = "2026-10-25T10:00:00.000Z", fresh = "2026-10-25T11:55:00.000Z", due = "2026-10-26T10:00:00.000Z";
const now = new Date("2026-10-25T12:00:00.000Z");
function fixture(kind: "VOLUNTEER" | "EDUCATION_CERTIFICATION" | "PROJECT" | "CAREGIVING" = "VOLUNTEER", completionStatus = "Completed", withQuestions = false,
  datePrecision: "YEAR" | "MONTH" | "UNKNOWN" = "YEAR", breakChoice: "OMIT_ENTRY" | "CAREER_BREAK" | "FAMILY_CAREGIVING" | "CUSTOM_WORDING" = "OMIT_ENTRY") {
  const contact = { schemaVersion: "chunk5-document-contact-v1", displayName: "Casey Example", email: "casey@example.test", phone: "212-555-0123", cityState: "Albany, NY", linkedInOrPortfolio: null };
  const plaintext = Buffer.from(JSON.stringify(contact));
  const answers = normalizedFourStepDraft({ ...structuredClone(emptyFourStepDraft), entryMode: "GUIDED", backgroundReviewed: true,
    fullName: contact.displayName, email: contact.email, phone: contact.phone, noPriorEmployment: true,
    experienceAdditions: [{ clientId: id(40), kind, organizationOrProject: "Community center", roleOrRelationship: kind === "EDUCATION_CERTIFICATION" ? "Student" : kind === "CAREGIVING" ? "Family caregiving" : "Volunteer coordinator",
      startsOn: "2024-01-01", endsOn: "2025-01-01", datePrecision, responsibilities: ["Organized event schedules"], tools: ["Spreadsheet"],
      scope: "", outcome: "", intensityPercent: null, educationLevel: kind === "EDUCATION_CERTIFICATION" ? "Certificate" : "", educationField: kind === "EDUCATION_CERTIFICATION" ? "Office support" : "",
      completionStatus: kind === "EDUCATION_CERTIFICATION" ? completionStatus : "", certifications: [], relevantCoursework: [], optionalDetail: "", current: false }], capabilities: {} });
  const receipt = { id: id(30), contractVersion: "applypack-confirmed-intake-v1", draftVersion: 4, reviewSha256: "c".repeat(64), sourceSha256: "d".repeat(64), answersSha256: canonicalSha256(answers), preparedAt: before, entryMode: "GUIDED" };
  const fact = { id: id(20), snapshot_id: id(5), customer_id: null, draft_id: id(6), semantic_key: `experience:${id(40)}`, value_kind: kind === "EDUCATION_CERTIFICATION" ? "EDUCATION" : "EXPERIENCE", typed_value: answers.experienceAdditions[0], source_kind: "CUSTOMER_ASSERTION",
    document_version_id: null, customer_assertion_snapshot_id: id(5), assertion_control_id: `experience-${id(40)}`, source_locator: "Customer confirmed guided background", verification: "CUSTOMER_CONFIRMED", confirmed_or_corrected_at: before,
    superseded_at: null, supersedes_fact_id: null, schema_version: "applypack-intake-v4", catalog_version: "applypack-experience-v1", starts_on: null, ends_on: null, calendar_duration_days: null, intensity_percent: null, capability_status: null, customer_display_label: null };
  const r = {
    line: { id: id(1), purchase_id: id(2), payment_attempt_id: id(3), delivered_order_id: id(11), delivered_match_id: id(12), active_revision: 1, allocated_amount_cents: 799, fulfillment: "PAID", materials_payment_verified_at: before, materials_started_at: before, materials_due_at: due, selected_reference_sheet: false },
    purchase: { id: id(2), customer_id: id(10), checkout_intent_id: id(7), payment_attempt_id: id(3), amount_cents: 799, currency: "USD", completed_at: before },
    payment: { id: id(3), customer_id: id(10), amount_cents: 799, currency: "USD", settlement: "PAID", payment_verified_at: before, immediate_charge_verified: true, dispute: "NONE", funds_reversed_at: null },
    revision: { id: id(4), line_id: id(1), version: 1, binding_sha256: "a".repeat(64), source_snapshot_id: id(5), job_snapshot_id: id(8), employer_rule_snapshot_id: id(9), revision_kind: "ORIGINAL", parent_revision_id: null, accepted_at: before, started_at: before, due_at: due, superseded_at: null, reference_scope: null },
    snapshot: { id: id(5), customer_id: id(10), draft_id: id(6), schema_version: "applypack-intake-v4", canonicalization_version: CANONICALIZATION_VERSION, content_sha256: "a".repeat(64), sensitive_payload_id: id(31), finalized_at: before, confirmed_review: receipt },
    sourcePayload: { id: id(31), customer_id: null, draft_id: id(6), content_sha256: "f".repeat(64), retention_state: "ACTIVE" },
    draft: { id: id(6), converted_customer_id: id(10), finalized_snapshot_id: id(5), version: 5, confirmation_receipt: receipt, answers, retention_state: "ACTIVE" },
    intent: { id: id(7), customer_id: id(10), purchase_id: id(2), payment_attempt_id: id(3), delivered_order_id: id(11), delivered_release_id: id(13), source_snapshot_id: id(5), state: "COMPLETED", line_count: 1, amount_cents: 799, currency: "USD", selection_sha256: "e".repeat(64), document_contact_confirmed: true, document_facts_confirmed: true, contact_payload_id: id(14), career_break_choice: breakChoice, career_break_custom_label: breakChoice === "CUSTOM_WORDING" ? "Family responsibilities" : null, cover_letter_break_consent: false },
    contact: { id: id(14), customer_id: id(10), content_sha256: hash(plaintext), retention_state: "ACTIVE" },
    contactFact: { id: id(14), snapshot_id: id(5), customer_id: id(10), semantic_key: "document_contact.confirmed", value_kind: "PROTECTED_COMPOSITE",
      typed_value: { protectedPayloadId: id(14), contentSha256: hash(plaintext) }, source_kind: "CUSTOMER_ASSERTION", customer_assertion_snapshot_id: id(5),
      assertion_control_id: "chunk5_document_contact_confirmation", source_locator: "materials_checkout", verification: "CUSTOMER_CONFIRMED",
      confirmed_or_corrected_at: before, superseded_at: null, catalog_version: "chunk5-document-contact-v1", schema_version: "chunk5-document-contact-v1" },
    item: { id: id(15), checkout_intent_id: id(7), material_line_id: id(1), delivered_match_id: id(12), job_snapshot_id: id(8), submission_rule_id: id(9), emphasis_note: "", do_not_mention_note: "" },
    job: { id: id(8), legacy_job_id: id(16), content_sha256: "b".repeat(64), company: "Example employer", exact_title: "Office assistant", canonical_application_url: "https://employer.example/apply", source_url: "https://employer.example/job", captured_listing: { text: "Organize office records" }, discovery_source: "manual", external_job_id: null, source_run_id: null, source_authorization_id: null, retrieved_at: before, live_verified_at: fresh, listing_activity_result: "PASS", application_path_result: "PASS", legitimacy_result: "PASS" },
    rule: { id: id(9), job_snapshot_id: id(8), content_sha256: "c".repeat(64), checked_at: fresh, human_confirmed_at: fresh, human_confirmed_by: id(17), is_current: true, superseded_at: null, injection_scan_state: "CLEAR", hard_block_reason: null, allowed_formats: ["PDF"], resume_page_limit: 1, cover_letter_page_limit: 1, resume_requirement: "REQUIRED", cover_letter_requirement: "OPTIONAL", resume_filename_instruction: null, cover_letter_filename_instruction: null, reference_timing: "LATER_OR_UNKNOWN", reference_count: null, source_evidence_ids: [id(22)], application_questions: [] },
    listingCheck: { id: id(18), material_line_id: id(1), line_revision_id: id(4), job_snapshot_id: id(8), submission_rule_id: id(9), evidence_sha256: "c".repeat(64), phase: "BEFORE_GENERATION", result: "ACTIVE", checked_at: fresh },
    facts: [fact], sourceFacts: [], documents: [], factReviews: [], requirements: [{ id: id(22), job_snapshot_id: id(8), node_kind: "CRITERION", stable_criterion_id: id(23), source_excerpt: "Organize office records", source_locator: "Listing", requirement_strength: "REQUIRED", typed_value: { kind: "RESPONSIBILITY" }, position: 0 }], reviews: [],
    questionSourceNodes: [{ id: id(22), job_snapshot_id: id(8), source_excerpt: "Organize office records" }], questionSourceAuthority: null,
    referencePermissions: [], referencePermissionIds: [], ownsSnapshot: true, verifiedJobSnapshotIds: [id(8)], successorJobIds: [], refundIds: [],
  } as DraftingEvidenceRecords;
  if (withQuestions) {
    const rawResponse = { id: 123, questions: [{ label: "Describe how you prioritize competing requests.", required: true, fields: [{ name: "question_1", type: "textarea" }] }] };
    const capture = { schemaVersion: "applypack-greenhouse-question-capture-v1", sourceId: "duolingo", boardToken: "duolingo", externalJobId: "123",
      sourceUrl: "https://boards-api.greenhouse.io/v1/boards/duolingo/jobs/123?questions=true", capturedAt: before,
      authority: { sourceRunId: id(32), authorizationId: id(33), authorizationVersion: "fixture-v1", authorizationHeadRevision: 1, scopeSha256: "a".repeat(64) },
      outcome: "RESPONSE", reasonCode: "CAPTURED", httpStatus: 200, rawResponse, rawResponseSha256: questionResponseSha256(rawResponse) };
    Object.assign(r.job, { discovery_source: "duolingo", external_job_id: "123", source_run_id: id(32), source_authorization_id: id(33),
      captured_listing: { text: "Organize office records", parserIssues: [], fieldEvidence: {}, applicationQuestionObservation: capture,
        rawSourceEvidence: captureRawSourceEvidence("greenhouse-v4", { listing: { id: 123 }, applicationQuestionObservation: capture }) } });
    r.job.content_sha256 = canonicalSha256(r.job.captured_listing);
    r.questionSourceAuthority = { run: { id: id(32), source_id: "duolingo", adapter_version: "greenhouse-v4", source_authorization_id: id(33), authorization_head_revision: 1,
      scope_sha256: "a".repeat(64), status: "succeeded", enumeration_status: "complete" }, authorization: { id: id(33), source_id: "duolingo", authorization_version: "fixture-v1", allowed_actions: ["READ_APPLICATION_QUESTIONS"], state: "AUTHORIZED_AUTOMATED" },
      head: { source_id: "duolingo", current_authorization_id: id(33), revision: 1 } };
  }
  r.snapshot.content_sha256 = canonicalSha256({ ...buildFourStepSnapshot(answers, r.sourcePayload.content_sha256, CANONICALIZATION_VERSION), confirmedReview: receipt });
  r.revision.binding_sha256 = hash(`${r.intent.selection_sha256}:${r.job.content_sha256}:${r.rule.content_sha256}`);
  const expected = { customerId: id(10), materialLineId: id(1), revisionId: id(4), revisionVersion: 1, bindingSha256: r.revision.binding_sha256 };
  const packet = buildDraftingEvidencePacket(r, expected, now);
  const claim: DraftProseClaim = { text: "Organized schedules for community activities.", sourceAtomIds: [packet.providerView.facts[0].atoms.find((atom) => atom.path === "/responsibilities/0")!.id], jobEvidenceIds: [], questionIds: packet.providerView.employerQuestionInsights.questions.map((question) => question.id), relation: completionStatus === "IN_PROGRESS" ? "QUALIFIED" : "DIRECT" };
  const draft = { schemaVersion: "applypack-draft-proposal-v1", language: "en-US", resume: { summary: [], skills: [], sections: kind === "EDUCATION_CERTIFICATION" ? [] : [{ anchorFactId: id(20), bullets: [claim] }], educationFactIds: kind === "EDUCATION_CERTIFICATION" ? [id(20)] : [] }, coverLetter: { body: [{ sentences: [{ ...claim, text: completionStatus === "IN_PROGRESS" ? "My current coursework includes organizing event schedules." : "I gained experience organizing community event schedules." }] }] } } as DraftOutput;
  const proposal = validateDraftOutput(draft, packet, now);
  const input = { packet, proposal, contact: { payloadId: id(14), plaintext }, finalVersionAt: now.toISOString() };
  return { input, r, draft, build: () => buildDraftRenderSource(input, now) };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { serializeDraftProposal } from "@/lib/documents/draft-output";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
const dependency = vi.hoisted(() => ({ read: vi.fn(), store: vi.fn(), load: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/documents/draft-packet-worker", async (original) => ({ ...await original<typeof import("@/lib/documents/draft-packet-worker")>(),
  readEncryptedDraftPayload: dependency.read, storeEncryptedDraftPayload: dependency.store }));
vi.mock("@/lib/documents/drafting-evidence-server", () => ({ loadDraftingEvidencePacket: dependency.load }));
vi.mock("@/lib/security/remote-kms", () => ({ remoteKmsAdapter: () => ({}) }));
vi.mock("@/lib/security/sensitive-payload", () => ({ decryptSensitivePayload: dependency.decrypt,
  sensitivePayloadConfiguration: () => ({ enabled: true }), sensitivePayloadEncryptionReady: () => true }));
import { createDraftOwnerServer } from "@/lib/documents/draft-owner-server";

type Call = { kind: "table" | "rpc"; name: string; args?: Record<string, unknown>; columns?: string; filters: Array<[string, unknown]>; signal?: AbortSignal };
type Receipt = { data: unknown; error: unknown };
function database(base = fixture()) {
  const { packet, proposal } = base.input, reviewerId = id(90), jobId = id(91), originalId = id(92), packetId = id(93), proposalId = id(94);
  const job = { id: jobId, customer_id: packet.expected.customerId, material_line_id: packet.expected.materialLineId, line_revision_id: packet.expected.revisionId,
    source_snapshot_id: packet.binding.snapshotId, state: "SOURCE_READY", active_version_id: originalId };
  const original = { id: originalId, job_id: jobId, customer_id: job.customer_id, material_line_id: job.material_line_id, version: 1, supersedes_id: null as string | null,
    packet_encrypted_payload_id: packetId, packet_sha256: packet.packetSha256, context_sha256: "c".repeat(64), encrypted_payload_id: proposalId, source_sha256: proposal.sourceSha256,
    invalidated_at: null as string | null, member_set_sha256: null as string | null, claim_review_encrypted_payload_id: null as string | null, claim_review_sha256: null as string | null,
    claim_review_metadata: [] as unknown, claims_reviewed_by: null as string | null, claims_reviewed_at: null as string | null };
  const versions = new Map([[originalId, original]]), bodies = new Map([[packetId, serializeDraftingEvidencePacket(packet)], [proposalId, serializeDraftProposal(proposal)]]);
  const revision = { id: base.r.revision.id, line_id: job.material_line_id, source_snapshot_id: job.source_snapshot_id, version: 1,
    binding_sha256: base.r.revision.binding_sha256, due_at: base.r.revision.due_at, superseded_at: null };
  const contact = { id: packet.binding.contactPayloadId, customer_id: job.customer_id, content_sha256: packet.binding.contactSha256, retention_state: "ACTIVE",
    encryption_context_hash: "f".repeat(64), encryption_algorithm: "AES-256-GCM", ciphertext: "\\x01", encrypted_data_key: "\\x02", nonce: "\\x" + "03".repeat(12), authentication_tag: "\\x" + "04".repeat(16),
    kms_key_identity: "reviewed-key", kms_key_version: "reviewed-version" };
  const calls: Call[] = [], readBuffers: Buffer[] = [], overrides = new Map<string, Array<(call: Call) => Receipt | Promise<Receipt>>>();
  let currentContext = original.context_sha256, clock = now, nextId = 100;
  let lostPromotion = false, lostReview = false, suppressMutation = false;
  function rpc(call: Call): Receipt {
    const args = call.args!;
    if (call.name === "ap_require_material_reviewer") return { data: null, error: null };
    if (call.name === "ap_material_draft_context_sha256") return { data: currentContext, error: null };
    if (call.name === "ap_revise_material_draft_source") {
      const prior = versions.get(String(args.p_version_id))!;
      const next = { ...prior, id: id(nextId++), supersedes_id: prior.id, version: prior.version + 1,
        encrypted_payload_id: String(args.p_source_payload_id), source_sha256: String(args.p_source_sha256) };
      if (!suppressMutation) { prior.invalidated_at = clock.toISOString(); versions.set(next.id, next); job.active_version_id = next.id; }
      if (lostPromotion) throw new Error("PRIVATE_RPC_DETAIL");
      return { data: next.id, error: null };
    }
    if (call.name === "ap_record_material_draft_claim_review") {
      const version = versions.get(String(args.p_version_id))!;
      if (!suppressMutation) Object.assign(version, { claim_review_encrypted_payload_id: args.p_review_payload_id, claim_review_sha256: args.p_review_sha256,
        claim_review_metadata: args.p_claims, claims_reviewed_by: args.p_reviewer_id, claims_reviewed_at: clock.toISOString() });
      if (lostReview) throw new Error("PRIVATE_RPC_DETAIL");
      return { data: args.p_review_sha256, error: null };
    }
    throw new Error(`Unexpected synthetic operation: ${call.name}`);
  }
  const queryFor = (call: Call) => {
    calls.push(call);
    const run = async (): Promise<Receipt> => {
      const override = overrides.get(call.name)?.shift(); if (override) return override(call);
      if (call.kind === "rpc") return rpc(call);
      const key = call.filters.find(([name]) => name === "id")?.[1];
      const row = call.name === "ap_material_draft_jobs" ? job : call.name === "ap_material_draft_versions" ? versions.get(String(key))
        : call.name === "ap_material_line_revisions" ? revision : call.name === "ap_sensitive_payloads" ? contact : null;
      return { data: row && call.columns ? structuredClone(Object.fromEntries(call.columns.split(",").map((column) => [column, (row as Record<string, unknown>)[column]]))) : structuredClone(row), error: null };
    };
    const query = { select: (columns: string) => { call.columns = columns; return query; }, eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      abortSignal: (value: AbortSignal) => { call.signal = value; return query; }, single: run,
      then: (resolve: (value: Receipt) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject) };
    return query;
  };
  const admin = { from: (name: string) => queryFor({ kind: "table", name, filters: [] }), rpc: (name: string, args: Record<string, unknown>) => queryFor({ kind: "rpc", name, args, filters: [] }) } as unknown as SupabaseClient<Database>;
  dependency.load.mockImplementation(async () => packet);
  dependency.read.mockImplementation(async (_admin, args) => { const body = bodies.get(args.payloadId); if (body === undefined) throw new Error("PRIVATE_MISSING_PAYLOAD");
    const bytes = Buffer.from(body); readBuffers.push(bytes); return bytes; });
  dependency.store.mockImplementation(async (_admin, args) => { expect(hash(args.body)).toBe(args.sha256); bodies.set(args.payloadId, args.body); return { payloadId: args.payloadId, sha256: args.sha256 }; });
  dependency.decrypt.mockImplementation(async () => { const bytes = Buffer.from(base.input.contact.plaintext); readBuffers.push(bytes); return bytes; });
  const services = createDraftOwnerServer(admin, reviewerId, { now: () => clock });
  const promote = (extra = {}) => services.promoteSource({ jobId, expectedVersionId: originalId, expectedSourceSha256: original.source_sha256, ...extra }, new AbortController().signal);
  const current = () => versions.get(job.active_version_id)!;
  const reviewRequest = () => {
    const version = current(), source = JSON.parse(bodies.get(version.encrypted_payload_id)!);
    return { jobId, request: { versionId: version.id, packetSha256: version.packet_sha256, sourceSha256: version.source_sha256,
      claims: source.ownerReviewClaims.map((claim: { claimId: string; wordingSha256: string }) => ({ claimId: claim.claimId, wordingSha256: claim.wordingSha256, decision: "APPROVED" })) } };
  };
  const review = () => services.recordWordingReview(reviewRequest(), new AbortController().signal);
  return { base, admin, services, job, original, revision, contact, versions, bodies, calls, readBuffers, overrides, promote, review, reviewRequest, current, reviewerId,
    setContext: (value: string) => { currentContext = value; }, setClock: (value: Date) => { clock = value; },
    losePromotion: () => { lostPromotion = true; }, loseReview: () => { lostReview = true; }, suppressMutation: () => { suppressMutation = true; } };
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("owner source promotion and exact wording review", () => {
  it("does no I/O on construction and rejects browser reviewer/payload additions before reading", async () => {
    const f = database(); expect(f.calls).toEqual([]);
    await expect(f.promote({ reviewerId: id(98) })).rejects.toThrow("INPUT_INVALID"); expect(f.calls).toEqual([]);
  });
  it("checks the actual owner role before any private data or decryption", async () => {
    const f = database(); f.overrides.set("ap_require_material_reviewer", [() => ({ data: null, error: { message: "private denial" } })]);
    await expect(f.promote()).rejects.toThrow("DRAFT_OWNER_UNCONFIRMED");
    expect(f.calls).toHaveLength(1); expect(dependency.read).not.toHaveBeenCalled();
  });
  it("promotes a real validated proposal to a distinct source version using original paid contact and exact CAS", async () => {
    const f = database(), result = await f.promote();
    expect(result).toMatchObject({ versionId: id(100), state: "OWNER_REVIEW_REQUIRED", deliveryAuthorized: false, reconciled: false });
    expect(result.sourceSha256).not.toBe(f.original.source_sha256); expect(f.original.invalidated_at).toBe(now.toISOString());
    const mutation = f.calls.find((call) => call.name === "ap_revise_material_draft_source")!;
    expect(mutation.args).toEqual({ p_version_id: f.original.id, p_expected_source_sha256: f.original.source_sha256,
      p_source_payload_id: f.current().encrypted_payload_id, p_source_sha256: result.sourceSha256, p_reviewer_id: f.reviewerId });
    const body = f.bodies.get(f.current().encrypted_payload_id)!, source = JSON.parse(body);
    expect(source.finalVersionAt).toBe(now.toISOString()); expect(source.resume.sections[0].header[0].text).toBe("Volunteer coordinator");
    expect(source.coverLetter.signature.text).toBe("Casey Example"); expect(hash(body)).toBe(result.sourceSha256);
    expect(dependency.decrypt.mock.calls[0][0].context).toEqual({ customerId: f.job.customer_id, payloadId: f.contact.id, purpose: "CHUNK5_DOCUMENT_CONTACT" });
    expect(f.readBuffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(f.calls.every((call) => call.signal instanceof AbortSignal && call.columns !== "*")).toBe(true);
    expect(f.calls.some((call) => /approve|send|dispatch/.test(call.name))).toBe(false);
  });
  it("supports education-only input and an explicitly selected confirmed career break", async () => {
    const education = database(fixture("EDUCATION_CERTIFICATION", "IN_PROGRESS")); await education.promote();
    expect(JSON.parse(education.bodies.get(education.current().encrypted_payload_id)!).resume.sections).toEqual([]);
    const care = database(fixture("CAREGIVING", "Completed", false, "MONTH", "CAREER_BREAK")); await care.promote({ careerBreakFactId: id(20) });
    expect(JSON.parse(care.bodies.get(care.current().encrypted_payload_id)!).resume.careerBreak.selection).toBe("OWNER_SELECTED");
  });
  it.each(["version", "customer", "line", "snapshot", "context", "deadline", "state", "invalidated", "rendered"])("rejects stale or mixed %s before private decryption", async (mode) => {
    const f = database();
    if (mode === "version") f.job.active_version_id = id(99);
    if (mode === "customer") f.original.customer_id = id(99);
    if (mode === "line") f.original.material_line_id = id(99);
    if (mode === "snapshot") f.revision.source_snapshot_id = id(99);
    if (mode === "context") f.setContext("e".repeat(64));
    if (mode === "deadline") f.revision.due_at = now.toISOString();
    if (mode === "state") f.job.state = "RELEASED";
    if (mode === "invalidated") f.original.invalidated_at = now.toISOString();
    if (mode === "rendered") f.original.member_set_sha256 = "a".repeat(64);
    await expect(f.promote()).rejects.toThrow("DRAFT_OWNER_"); expect(dependency.read).not.toHaveBeenCalled();
  });
  it.each(["bytes", "same hash altered receipt", "foreign current packet"])("rejects %s in saved proposal/packet", async (mode) => {
    const f = database();
    if (mode === "bytes") f.bodies.set(f.original.encrypted_payload_id, "{}");
    if (mode === "same hash altered receipt") { const saved = JSON.parse(f.bodies.get(f.original.encrypted_payload_id)!); saved.reviews[0].text = "Forged";
      const body = JSON.stringify(saved); f.bodies.set(f.original.encrypted_payload_id, body); f.original.source_sha256 = hash(body); }
    if (mode === "foreign current packet") dependency.load.mockResolvedValue(fixture("PROJECT").input.packet);
    await expect(f.promote()).rejects.toThrow("DRAFT_OWNER_"); expect(dependency.store).not.toHaveBeenCalled();
    expect(f.readBuffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it.each(["owner", "hash", "retention", "plaintext"])("rejects mismatched contact %s and clears plaintext", async (mode) => {
    const f = database();
    if (mode === "owner") f.contact.customer_id = id(99);
    if (mode === "hash") f.contact.content_sha256 = "a".repeat(64);
    if (mode === "retention") f.contact.retention_state = "DELETED";
    if (mode === "plaintext") dependency.decrypt.mockImplementation(async () => { const bytes = Buffer.from("private forged contact"); f.readBuffers.push(bytes); return bytes; });
    await expect(f.promote()).rejects.toThrow("DRAFT_OWNER_"); expect(dependency.store).not.toHaveBeenCalled();
    expect(f.readBuffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("reconciles a committed promotion after a lost response without a second mutation", async () => {
    const f = database(); f.losePromotion(); expect(await f.promote()).toMatchObject({ versionId: id(100), reconciled: true });
    expect(f.calls.filter((call) => call.name === "ap_revise_material_draft_source")).toHaveLength(1);
  });
  it("keeps ambiguous uncommitted payloads and reports unknown instead of replaying or deleting", async () => {
    const f = database(); f.losePromotion(); f.suppressMutation();
    await expect(f.promote()).rejects.toThrow("RESULT_UNKNOWN"); expect(dependency.store).toHaveBeenCalledTimes(1);
    expect(f.bodies.size).toBe(3); expect(f.calls.filter((call) => call.name === "ap_revise_material_draft_source")).toHaveLength(1);
  });
  it("blocks context changes occurring after encryption and before source CAS", async () => {
    const f = database(); dependency.store.mockImplementationOnce(async (_admin, input) => { f.setContext("d".repeat(64)); return { payloadId: input.payloadId, sha256: input.sha256 }; });
    await expect(f.promote()).rejects.toThrow("CONTEXT_STALE"); expect(f.calls.some((call) => call.name === "ap_revise_material_draft_source")).toBe(false);
  });
  it("records all explicit wording decisions once with server reviewer and minimal DB metadata", async () => {
    const f = database(); await f.promote(); const result = await f.review();
    expect(result).toMatchObject({ versionId: id(100), reconciled: false, deliveryAuthorized: false });
    const mutation = f.calls.find((call) => call.name === "ap_record_material_draft_claim_review")!;
    expect(mutation.args).toMatchObject({ p_version_id: id(100), p_reviewer_id: f.reviewerId, p_source_sha256: f.current().source_sha256, p_packet_sha256: f.current().packet_sha256 });
    expect(JSON.stringify(mutation.args)).not.toContain("Casey Example"); expect(JSON.stringify(mutation.args)).not.toContain("Volunteer coordinator");
    const storedReview = f.bodies.get(f.current().claim_review_encrypted_payload_id!)!;
    expect(storedReview).toContain("Casey Example"); expect(hash(storedReview)).toBe(result.reviewSha256);
    const stores = dependency.store.mock.calls.length; expect(await f.review()).toMatchObject({ reviewSha256: result.reviewSha256, reconciled: true });
    expect(dependency.store.mock.calls).toHaveLength(stores); expect(f.calls.filter((call) => call.name === "ap_record_material_draft_claim_review")).toHaveLength(1);
    expect(f.readBuffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it.each(["missing", "duplicate", "wrong hash", "extra reviewer", "false decision"])("rejects %s owner wording decision without recording approval", async (mode) => {
    const f = database(); await f.promote(); const request = f.reviewRequest();
    if (mode === "missing") request.request.claims.pop();
    if (mode === "duplicate") request.request.claims[1] = request.request.claims[0];
    if (mode === "wrong hash") request.request.claims[0].wordingSha256 = "a".repeat(64);
    if (mode === "extra reviewer") Object.assign(request.request, { reviewerId: id(99) });
    if (mode === "false decision") request.request.claims[0].decision = "REJECTED";
    await expect(f.services.recordWordingReview(request, new AbortController().signal)).rejects.toThrow("DRAFT_OWNER_");
    expect(f.calls.some((call) => call.name === "ap_record_material_draft_claim_review")).toBe(false);
  });
  it("requires strict saved render source and exact displayed claim set even under a matching stored hash", async () => {
    const f = database(); await f.promote(); const v = f.current(), body = JSON.parse(f.bodies.get(v.encrypted_payload_id)!);
    body.resume.sections[0].bullets[0].factRefs[0].factId = id(99);
    const changed = { ...body, renderSourceSha256: "" }; const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
      : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
    const serialized = canonical(body); changed.renderSourceSha256 = hash(serialized);
    expect(serializeDraftRenderSource(changed)).toBe(serialized); f.bodies.set(v.encrypted_payload_id, serialized); v.source_sha256 = hash(serialized);
    await expect(f.review()).rejects.toThrow("CLAIM_SET_INVALID");
  });
  it("reconciles lost wording review without recording another decision", async () => {
    const f = database(); await f.promote(); f.loseReview(); expect(await f.review()).toMatchObject({ reconciled: true });
    expect(f.calls.filter((call) => call.name === "ap_record_material_draft_claim_review")).toHaveLength(1);
  });
  it("does not call a proposal an approved render source or promote the render source again", async () => {
    const f = database(); await expect(f.services.recordWordingReview({ jobId: f.job.id, request: { versionId: f.original.id,
      packetSha256: f.original.packet_sha256, sourceSha256: f.original.source_sha256, claims: [{ claimId: id(20), wordingSha256: "a".repeat(64), decision: "APPROVED" }] } }, new AbortController().signal)).rejects.toThrow("SOURCE_INVALID");
    await f.promote(); const current = f.current();
    await expect(f.services.promoteSource({ jobId: f.job.id, expectedVersionId: current.id, expectedSourceSha256: current.source_sha256 }, new AbortController().signal)).rejects.toThrow("PROPOSAL_REQUIRED");
  });
  it("bounds a hung provider read and aborts before any mutation", async () => {
    vi.useFakeTimers(); const f = database(); f.overrides.set("ap_require_material_reviewer", [() => new Promise(() => {})]);
    const pending = f.promote(); const assertion = expect(pending).rejects.toThrow("ABORTED"); await vi.advanceTimersByTimeAsync(60_001); await assertion;
    expect(f.calls[0].signal?.aborted).toBe(true); expect(dependency.read).not.toHaveBeenCalled();
  });
  it("clears a late returned decrypt buffer after cancellation", async () => {
    const f = database(), controller = new AbortController(); let resolve: ((value: Buffer) => void) | undefined;
    dependency.decrypt.mockImplementation(() => new Promise<Buffer>((done) => { resolve = done; }));
    const pending = f.services.promoteSource({ jobId: f.job.id, expectedVersionId: f.original.id, expectedSourceSha256: f.original.source_sha256 }, controller.signal);
    for (let i = 0; i < 40 && !resolve; i++) await Promise.resolve();
    expect(resolve).toBeDefined(); controller.abort(); await expect(pending).rejects.toThrow("ABORTED");
    const bytes = Buffer.from(f.base.input.contact.plaintext); resolve!(bytes); for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(bytes.every((byte) => byte === 0)).toBe(true); expect(dependency.store).not.toHaveBeenCalled();
  });
});
