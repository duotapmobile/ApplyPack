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
  datePrecision: "YEAR" | "MONTH" | "UNKNOWN" = "YEAR", breakChoice: "OMIT_ENTRY" | "CAREER_BREAK" | "FAMILY_CAREGIVING" | "CUSTOM_WORDING" = "OMIT_ENTRY", withReferences = false) {
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
  if (withReferences) { r.line.selected_reference_sheet = true; r.referencePermissionIds = [id(70)]; r.referencePermissions = [{ id: id(70), customer_id: id(10), delivered_release_id: id(13), job_snapshot_id: id(8), job_snapshot_hash: r.job.content_sha256, reference_record_version_id: id(71), revoked_at: null, contact_version_changed_at: null }]; }
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
import { DOCUMENT_GENERATOR_VERSION } from "@/lib/documents/requirements";
const dependencies = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ readEncryptedDraftPayload: dependencies.read }));
vi.mock("@/lib/documents/drafting-evidence-server", () => ({ loadDraftingEvidencePacket: dependencies.load }));
vi.mock("@/lib/security/remote-kms", () => ({ remoteKmsAdapter: () => ({}) }));
vi.mock("@/lib/security/sensitive-payload", () => ({ decryptSensitivePayload: dependencies.decrypt,
  sensitivePayloadConfiguration: () => ({}), sensitivePayloadEncryptionReady: () => true }));
import { createDraftOwnerView } from "@/lib/documents/draft-owner-view";
import { readConfirmedDraftContact } from "@/lib/documents/draft-owner-contact";

type Call = { name: string; args?: Record<string, unknown>; columns?: string; filters: [string, unknown][]; signal?: AbortSignal; limit?: number; orders: string[]; cursor?: string; single?: boolean };
function database(mode: "proposal" | "source" = "proposal", withQuestions = false, withReferences = false) {
  const base = fixture("VOLUNTEER", "Completed", withQuestions, "YEAR", "OMIT_ENTRY", withReferences), packet = base.input.packet;
  const source = mode === "source" ? base.build() : base.input.proposal;
  const sourceBody = mode === "source" ? serializeDraftRenderSource(base.build()) : serializeDraftProposal(base.input.proposal);
  const job = { id: id(91), customer_id: id(10), material_line_id: id(1), line_revision_id: id(4), source_snapshot_id: id(5), state: "SOURCE_READY", active_version_id: id(92) as string | null, error_code: null, created_at: before, updated_at: fresh };
  const version = { id: id(92), job_id: id(91), customer_id: id(10), material_line_id: id(1), version: 1, packet_encrypted_payload_id: id(93), packet_sha256: packet.packetSha256, context_sha256: "f".repeat(64), encrypted_payload_id: id(94) as string | null, source_sha256: "sourceSha256" in source ? source.sourceSha256 : source.renderSourceSha256,
    invalidated_at: null as string | null, member_set_sha256: null as string | null, claim_review_sha256: null as string | null, claims_reviewed_at: null as string | null, approval_sha256: null as string | null, approved_at: null as string | null, release_id: null };
  const calls: Call[] = [], buffers: Buffer[] = [];
  const bodies = new Map([[id(93), serializeDraftingEvidencePacket(packet)], [id(94), sourceBody]]);
  const tables: Record<string, Record<string, unknown>[]> = { ap_material_draft_jobs: [job], ap_material_draft_versions: [version], ap_material_line_revisions: [{ ...base.r.revision }], ap_material_draft_members: [], ap_generated_artifacts: [], ap_generated_file_versions: [], ap_artifact_quality_reviews: [], ap_employer_submission_rules: [{ ...base.r.rule }], ap_job_snapshots: [{ ...base.r.job }] };
  tables.ap_sensitive_payloads = [{ ...base.r.contact, encryption_context_hash: "f".repeat(64), encryption_algorithm: "AES-256-GCM", ciphertext: "\\x01", encrypted_data_key: "\\x02", nonce: "\\x" + "03".repeat(12), authentication_tag: "\\x" + "04".repeat(16), kms_key_identity: "fixture-key", kms_key_version: "1" }];
  let context = version.context_sha256;
  const overrides = new Map<string, (call: Call) => unknown | Promise<unknown>>();
  const query = (call: Call) => {
    const builder = {
      select: (columns: string) => { call.columns = columns; return builder; }, eq: (name: string, value: unknown) => { call.filters.push([name, value]); return builder; },
      in: () => builder, order: (name: string) => { call.orders.push(name); return builder; }, limit: (value: number) => { call.limit = value; return builder; },
      or: (value: string) => { call.cursor = value; return builder; }, abortSignal: (signal: AbortSignal) => { call.signal = signal; return builder; }, single: () => { call.single = true; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(async () => {
        calls.push(call); if (overrides.has(call.name)) return overrides.get(call.name)!(call);
        if (call.name === "ap_require_material_reviewer") return { data: null, error: null };
        if (call.name === "ap_material_draft_context_sha256") return { data: context, error: null };
        const rows = (tables[call.name] ?? []).filter((row) => call.filters.every(([name, value]) => row[name] === value)).map((row) => Object.fromEntries(call.columns!.split(",").map((key) => [key, row[key]])));
        return { data: call.single ? rows[0] ?? null : rows, error: null };
      }).then(resolve, reject),
    }; return builder;
  };
  const admin = { from: (name: string) => query({ name, filters: [], orders: [] }), rpc: (name: string, args: Record<string, unknown>) => query({ name, args, filters: [], orders: [] }) } as unknown as SupabaseClient<Database>;
  dependencies.load.mockImplementation(async () => packet);
  dependencies.read.mockImplementation(async (_admin, binding) => { const bytes = Buffer.from(bodies.get(binding.payloadId)!); buffers.push(bytes); return bytes; });
  dependencies.decrypt.mockImplementation(async () => { const bytes = Buffer.from(base.input.contact.plaintext); buffers.push(bytes); return bytes; });
  const view = createDraftOwnerView(admin, id(90), { now: () => now });
  function pair() {
    version.member_set_sha256 = "a".repeat(64); version.claim_review_sha256 = "b".repeat(64); version.claims_reviewed_at = fresh; job.state = "REVIEW_READY";
    for (const [index, artifactType] of ["RESUME", "COVER_LETTER"].entries()) {
      const artifactId = id(200 + index), fileId = id(210 + index), checksum = String(index + 1).repeat(64), preview = String(index + 3).repeat(64);
      tables.ap_material_draft_members.push({ customer_id: job.customer_id, material_line_id: job.material_line_id, draft_version_id: version.id, artifact_type: artifactType, artifact_id: artifactId, file_version_id: fileId, file_sha256: checksum, preview_sha256: preview, source_sha256: version.source_sha256 });
      tables.ap_generated_artifacts.push({ id: artifactId, customer_id: job.customer_id, material_line_id: job.material_line_id, source_line_revision_id: job.line_revision_id, artifact_type: artifactType, current_file_version: 1, generator_version: DOCUMENT_GENERATOR_VERSION, retention_state: "ACTIVE" });
      tables.ap_generated_file_versions.push({ id: fileId, artifact_id: artifactId, version: 1, checksum_sha256: checksum, safe_filename: `${artifactType}.pdf`, superseded_at: null, downloads_revoked_at: null });
      tables.ap_artifact_quality_reviews.push({ file_version_id: fileId, automated_passed_at: fresh, render_preview_bucket: "operator-render-previews", render_preview_sha256: preview, document_font_family: "Liberation Sans", document_font_resolved: true, invalidated_at: null });
    }
  }
  return { base, packet, job, version, bodies, tables, calls, buffers, overrides, admin, view, pair, setContext: (value: string) => { context = value; }, detail: () => view.detail(job.id, new AbortController().signal) };
}

describe("private owner draft read model", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());
  it("authorizes before the paginated metadata read and never decrypts the queue", async () => {
    const d = database(); for (let index = 0; index < 20; index++) d.tables.ap_material_draft_jobs.push({ ...d.job, id: id(300 + index) });
    const result = await d.view.list(null, new AbortController().signal);
    expect(result.status).toBe("AVAILABLE"); expect(result.jobs).toHaveLength(20); expect(result.nextCursor).not.toBeNull();
    expect(d.calls[0]).toMatchObject({ name: "ap_require_material_reviewer", args: { p_reviewer_id: id(90) } });
    expect(d.calls[1]).toMatchObject({ limit: 21, orders: ["created_at", "id"] }); expect(dependencies.read).not.toHaveBeenCalled();
    await d.view.list(result.nextCursor, new AbortController().signal); expect(d.calls.at(-1)?.cursor).toContain("created_at.lt.");
  });
  it("does not label failed authorization or a malformed cursor as an empty queue", async () => {
    const d = database(); d.overrides.set("ap_require_material_reviewer", () => ({ error: "private provider failure", data: null }));
    expect(await d.view.list(null, new AbortController().signal)).toEqual({ status: "UNAVAILABLE", jobs: [], nextCursor: null }); expect(d.calls).toHaveLength(1);
    d.overrides.clear(); expect((await d.view.list("forged", new AbortController().signal)).status).toBe("UNAVAILABLE");
  });
  it("distinguishes a successful empty page and pending/released jobs", async () => {
    const d = database(); d.tables.ap_material_draft_jobs = [];
    expect(await d.view.list(null, new AbortController().signal)).toEqual({ status: "AVAILABLE", jobs: [], nextCursor: null });
    d.tables.ap_material_draft_jobs = [d.job]; d.version.encrypted_payload_id = null;
    expect((await d.detail()).status).toBe("PENDING"); d.job.state = "RELEASED"; expect((await d.detail()).status).toBe("RELEASED");
  });
  it("exposes the exact initial listing check without inventing a version or decrypting private content", async () => {
    const d = database(); d.job.active_version_id = null; d.job.state = "EVIDENCE_PENDING";
    const result = await d.detail(); expect(result.status).toBe("PENDING");
    if (result.status === "PENDING") expect(result.initialListing).toEqual({ ruleSha256: d.base.r.rule.content_sha256, applicationUrl: "https://employer.example/apply", company: "Example employer", title: "Office assistant", revisionId: id(4), instructions: { checkedAt: fresh, resumeRequirement: "REQUIRED", letterRequirement: "OPTIONAL", resumeFilename: null, letterFilename: null, referenceTiming: "LATER_OR_UNKNOWN", referenceCount: null, formats: ["PDF"], resumePageLimit: 1, letterPageLimit: 1 } });
    expect(dependencies.read).not.toHaveBeenCalled(); expect(dependencies.load).not.toHaveBeenCalled();
    d.tables.ap_employer_submission_rules[0].job_snapshot_id = id(999); expect((await d.detail()).status).toBe("REFRESH_REQUIRED");
  });
  it("projects a real guided no-employment proposal and clears every decrypted buffer", async () => {
    const d = database(), result = await d.detail(); expect(result.status).toBe("AVAILABLE");
    if (result.status !== "AVAILABLE") throw new Error("expected available");
    expect(result.kind).toBe("PROPOSAL"); expect(result.canPromote).toBe(true); expect(result.canApprove).toBe(false); expect(result.canSend).toBe(false);
    expect(result.facts[0].fields).toContainEqual({ label: "responsibilities", value: "Organized event schedules" });
    expect(result.questions.status).toBe("NOT_INSPECTED"); expect(result.documents[1].sections[0].lines[0].text).toContain("community event schedules");
    expect(JSON.stringify(result)).not.toMatch(/ciphertext|rawSourceEvidence|protectedPayloadId/); expect(d.buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    expect(d.calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
  });
  it("shares strict saved-source decoding and displays exact contact, claim source and verified questions", async () => {
    const d = database("source", true), result = await d.detail(); expect(result.status).toBe("AVAILABLE"); if (result.status !== "AVAILABLE") return;
    expect(result.kind).toBe("RENDER_SOURCE"); expect(result.documents[0].sections[0].lines[0].text).toBe("Casey Example"); expect(result.canReviewWording).toBe(true);
    expect(result.claims.find((claim) => claim.text.startsWith("Organized schedules"))?.sources[0].value).toBe("Organized event schedules");
    expect(result.claims.find((claim) => claim.text === "Casey Example")?.sources).toEqual([{ label: "Confirmed checkout display Name", value: "Casey Example" }]);
    expect(result.claims.find((claim) => claim.text === "casey@example.test")?.sources).toEqual([{ label: "Confirmed checkout email", value: "casey@example.test" }]);
    expect(dependencies.decrypt.mock.calls[0][0].context).toEqual({ customerId: id(10), payloadId: id(14), purpose: "CHUNK5_DOCUMENT_CONTACT" });
    expect(result.instructions.saved).toEqual({ checkedAt: fresh, resumeRequirement: "REQUIRED", letterRequirement: "OPTIONAL", resumeFilename: null, letterFilename: null, referenceTiming: "LATER_OR_UNKNOWN", referenceCount: null, formats: ["PDF"], resumePageLimit: 1, letterPageLimit: 1 });
    expect(d.buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    expect(result.questions.items[0]).toMatchObject({ prompt: "Describe how you prioritize competing requests.", required: true, wordLimit: null, eligible: true });
  });
  it.each(["customer", "hash", "retired", "plaintext"])("withholds private review when confirmed contact has a mismatched %s", async (mode) => {
    const d = database("source"), contact = d.tables.ap_sensitive_payloads[0];
    if (mode === "customer") contact.customer_id = id(999);
    if (mode === "hash") contact.content_sha256 = "0".repeat(64);
    if (mode === "retired") contact.retention_state = "DELETED";
    if (mode === "plaintext") dependencies.decrypt.mockImplementation(async () => { const bytes = Buffer.from("wrong private contact"); d.buffers.push(bytes); return bytes; });
    expect((await d.detail()).status).toBe("UNAVAILABLE");
    expect(d.buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
  });
  it("does not treat a valid saved-source hash as proof of an altered contact value", async () => {
    const d = database("source"), source = JSON.parse(serializeDraftRenderSource(d.base.build()));
    const change = (value: unknown) => { if (value && typeof value === "object") { if ("text" in value && value.text === "Casey Example") { value.text = "Wrong Name"; if ("wordingSha256" in value) value.wordingSha256 = hash("Wrong Name"); } Object.values(value).forEach(change); } };
    change(source); const body = JSON.stringify(source); d.bodies.set(id(94), body); d.version.source_sha256 = hash(body);
    expect((await d.detail()).status).toBe("UNAVAILABLE");
    expect(d.buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
  });
  it.each(["retention_state", "customer_id", "content_sha256", "encryption_context_hash"])("rechecks contact %s after a delayed decrypt before exposing plaintext", async (field) => {
    const d = database("source"); let resolve: (bytes: Buffer) => void = () => undefined;
    dependencies.decrypt.mockImplementationOnce(() => new Promise<Buffer>((done) => { resolve = done; }));
    const pending = d.detail(); await vi.waitFor(() => expect(dependencies.decrypt).toHaveBeenCalledOnce());
    d.tables.ap_sensitive_payloads[0][field] = field === "retention_state" ? "DELETED" : field === "customer_id" ? id(999) : "0".repeat(64);
    const bytes = Buffer.from(d.base.input.contact.plaintext); resolve(bytes);
    expect((await pending).status).toBe("UNAVAILABLE"); expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(d.calls.filter((call) => call.name === "ap_sensitive_payloads")).toHaveLength(2);
  });
  it("snapshots the requested contact identity before asynchronous reads", async () => {
    const d = database("source"), binding = { customerId: id(10), payloadId: id(14), sha256: d.base.r.contact.content_sha256 };
    let resolve: (bytes: Buffer) => void = () => undefined;
    dependencies.decrypt.mockImplementationOnce(() => new Promise<Buffer>((done) => { resolve = done; }));
    const pending = readConfirmedDraftContact(d.admin, binding, new AbortController().signal);
    await vi.waitFor(() => expect(dependencies.decrypt).toHaveBeenCalledOnce()); binding.customerId = id(999); binding.payloadId = id(998); binding.sha256 = "0".repeat(64);
    resolve(Buffer.from(d.base.input.contact.plaintext)); const bytes = await pending;
    expect(bytes.toString()).toBe(d.base.input.contact.plaintext.toString()); bytes.fill(0);
    expect(d.calls.filter((call) => call.name === "ap_sensitive_payloads").every((call) => call.filters[0][1] === id(14))).toBe(true);
  });
  it.each(["customer_id", "material_line_id", "job_id"])("rejects a mixed version %s before decryption", async (field) => {
    const d = database(); Object.assign(d.version, { [field]: id(999) }); expect((await d.detail()).status).toBe("REFRESH_REQUIRED"); expect(dependencies.read).not.toHaveBeenCalled();
  });
  it("rejects a changed context, stale packet and in-flight version switch", async () => {
    const d = database(); d.setContext("0".repeat(64)); expect((await d.detail()).status).toBe("REFRESH_REQUIRED"); expect(dependencies.read).not.toHaveBeenCalled();
    d.setContext(d.version.context_sha256); dependencies.load.mockRejectedValueOnce(new Error("private stale source")); expect((await d.detail()).status).toBe("REFRESH_REQUIRED");
    dependencies.load.mockImplementationOnce(async () => { d.job.active_version_id = id(500); return d.packet; }); expect((await d.detail()).status).toBe("REFRESH_REQUIRED");
  });
  it("rejects malformed bytes, a valid hash over unsupported source JSON and source/claim disagreement", async () => {
    const d = database("source"); d.bodies.set(id(94), "not json"); expect((await d.detail()).status).toBe("UNAVAILABLE");
    const source = { ...d.base.build(), extra: "private" }; const body = JSON.stringify(source); d.bodies.set(id(94), body); d.version.source_sha256 = hash(body); expect((await d.detail()).status).toBe("UNAVAILABLE");
    const canonical = JSON.parse(serializeDraftRenderSource(d.base.build())); canonical.resume.header[0].text = "Forged identity"; const tampered = JSON.stringify(canonical); d.bodies.set(id(94), tampered); d.version.source_sha256 = hash(tampered); expect((await d.detail()).status).toBe("UNAVAILABLE");
  });
  it("does not display a fact as support when its exact scalar digest differs", async () => {
    const d = database("source"), source = JSON.parse(serializeDraftRenderSource(d.base.build()));
    const corrupt = (value: unknown) => { if (value && typeof value === "object") { if ("field" in value && value.field === "responsibilities.0" && "valueSha256" in value) value.valueSha256 = "0".repeat(64); Object.values(value).forEach(corrupt); } };
    corrupt(source); const body = JSON.stringify(source); d.bodies.set(id(94), body); d.version.source_sha256 = hash(body);
    expect((await d.detail()).status).toBe("UNAVAILABLE");
  });
  it("requires the actual complete bound file pair and compatible previews before approval", async () => {
    const d = database("source"); d.pair(); let result = await d.detail(); expect(result.status).toBe("AVAILABLE"); if (result.status !== "AVAILABLE") return;
    expect(result.canApprove).toBe(true); expect(result.canSend).toBe(false); expect(result.files[0].previewUrl).toContain(d.tables.ap_generated_file_versions[0].id);
    d.tables.ap_generated_artifacts[0].generator_version = "unsupported-new-generator"; result = await d.detail(); expect(result.status === "AVAILABLE" && result.canApprove).toBe(false);
    d.tables.ap_generated_file_versions[0].checksum_sha256 = "9".repeat(64); expect((await d.detail()).status).toBe("UNAVAILABLE");
  });
  it("does not infer sending from wording review or a member hash", async () => {
    const d = database("source"); d.pair(); d.job.state = "APPROVED"; let result = await d.detail(); expect(result.status === "AVAILABLE" && result.canSend).toBe(false);
    d.version.approval_sha256 = "c".repeat(64); d.version.approved_at = fresh; result = await d.detail(); expect(result.status === "AVAILABLE" && result.canSend).toBe(true);
  });
  it("never presents a two-file pair as complete when the paid scope includes a reference sheet", async () => {
    const d = database("source", false, true); d.pair(); let result = await d.detail();
    expect(result.status).toBe("AVAILABLE"); expect(result.status === "AVAILABLE" && result.canApprove).toBe(false);
    d.job.state = "APPROVED"; d.version.approval_sha256 = "c".repeat(64); d.version.approved_at = fresh; result = await d.detail(); expect(result.status === "AVAILABLE" && result.canSend).toBe(false);
  });
  it("rebuilds the real packet through paid fulfillment transitions before showing an approved pair", async () => {
    const d = database("source"); d.pair(); d.job.state = "APPROVED"; d.version.approval_sha256 = "c".repeat(64); d.version.approved_at = fresh;
    dependencies.load.mockImplementation(async () => buildDraftingEvidencePacket(d.base.r, d.packet.expected, now));
    for (const fulfillment of ["PAID", "GENERATING", "HUMAN_REVIEW", "READY_TO_RELEASE"] as const) {
      d.base.r.line.fulfillment = fulfillment; const result = await d.detail(); expect(result.status).toBe("AVAILABLE"); expect(result.status === "AVAILABLE" && result.canSend).toBe(true);
    }
    Object.assign(d.base.r.line, { fulfillment: "DELIVERED" }); expect((await d.detail()).status).toBe("REFRESH_REQUIRED");
  });
  it("bounds hung database waits and rejects cancellation before private reads", async () => {
    vi.useFakeTimers(); const d = database(); d.overrides.set("ap_require_material_reviewer", () => new Promise(() => undefined));
    const result = d.detail(); await vi.advanceTimersByTimeAsync(45_001); expect((await result).status).toBe("UNAVAILABLE"); expect(dependencies.read).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(); expect((await d.view.detail(d.job.id, controller.signal)).status).toBe("UNAVAILABLE");
  });
  it("clears plaintext even if a late decrypt completes after cancellation", async () => {
    const d = database(), controller = new AbortController(); let resolve: (bytes: Buffer) => void = () => undefined;
    dependencies.read.mockImplementationOnce(() => new Promise<Buffer>((done) => { resolve = done; }));
    const result = d.view.detail(d.job.id, controller.signal); await vi.waitFor(() => expect(dependencies.read).toHaveBeenCalledOnce());
    controller.abort(); expect((await result).status).toBe("UNAVAILABLE"); const bytes = Buffer.from(d.bodies.get(id(93))!); resolve(bytes); await new Promise((done) => setTimeout(done, 0)); expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
});
