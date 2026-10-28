import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createResearchLocalDatabase } from "./research-local-database";
vi.mock("server-only", () => ({}));
const boundary = vi.hoisted(() => ({ admin: null as unknown, cookie: "", selectedId: "", operatorId: "a1010000-0000-4000-8000-000000000001",
  userId: "a1010000-0000-4000-8000-000000000090", email: "clarification@example.invalid", verified: true }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: boundary.cookie }) }), headers: async () => new Headers({ "x-applypack-draft-id": boundary.selectedId }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => boundary.admin }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: boundary.verified ? { id: boundary.userId, email: boundary.email, email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: false } : null }, error: null }),
} }) }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: async () => ({ ok: true, user: { id: boundary.operatorId }, admin: boundary.admin }) }));
// Real AES-GCM encryption with a fictional local key-wrapping boundary. This
// journey proves route/DB binding, not an AWS/KMS or hosted encryption claim.
vi.mock("@/lib/security/remote-kms", () => ({ remoteKmsAdapter: () => ({ wrapDataKey: async () => Buffer.from("fictional-wrapped-key") }) }));
import { POST as issueQuestion } from "@/app/api/admin/matching-research/route";
import { GET as questions, POST as answerQuestion } from "@/app/api/intake/anonymous-draft/questions/route";
import { POST as answerCustomerQuestion } from "@/app/api/customer/candidate-questions/route";
import { GET as readDraft, PUT as saveDraft } from "@/app/api/intake/anonymous-draft/route";
import { POST as presentFact } from "@/app/api/intake/anonymous-draft/fact-presentation/route";
import { POST as reviewDraft } from "@/app/api/intake/anonymous-draft/review/route";
import { POST as finalizeDraft } from "@/app/api/intake/anonymous-draft/finalize/route";
import { GET as accessList, POST as accessAction } from "@/app/api/intake/access/route";
import { createDraftCapability, parseDraftCapability, serializeDraftCapability } from "@/lib/security/draft-capability";
import { emptyFourStepDraft, hardEmployerCriteria, normalizedFourStepDraft, type FourStepDraft } from "@/lib/intake/four-step";
const id = (n: number) => `a1010000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://clarification.example.invalid";
function post(path: string, body: unknown) { return new Request(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
async function result(response: Response, status: number, diagnostics: unknown) {
  const body = await response.json(); expect(response.status, JSON.stringify({ body, diagnostics })).toBe(status); return body;
}
afterEach(() => { vi.unstubAllEnvs(); boundary.cookie = ""; boundary.selectedId = ""; });
function selectCookie(response: Response) {
  boundary.cookie = decodeURIComponent(response.headers.get("set-cookie")!.split(";", 1)[0].split("=").slice(1).join("="));
  boundary.selectedId = parseDraftCapability(boundary.cookie)!.draftId;
}
it("answers through HTTP, recovers the review cookie, inherits exact resume sources and confirms only a complete new snapshot", async () => {
  const database = await createResearchLocalDatabase(); boundary.admin = database.admin;
  const original = { ...createDraftCapability(), draftId: id(2) };
  boundary.cookie = serializeDraftCapability(original);
  boundary.selectedId = original.draftId;
  const fixture = await readFile("tests/integration/material-clarification-confirmation.sql", "utf8");
  const cut = fixture.indexOf("create temp table question as"); expect(cut).toBeGreaterThan(0);
  let seed = fixture.slice(0, cut).replaceAll("repeat('a',64)", `'${original.secretHash}'`);
  seed = seed.replace('"entryMode":"GUIDED","backgroundReviewed"', '"email":"clarification@example.invalid","entryMode":"GUIDED","backgroundReviewed"');
  // Use actual registration, isolated extraction receipt and source fact rows.
  // The later successor must retain this precise document ID and source owner.
  const save = `select * from public.ap_save_four_step_draft('${id(2)}','${original.secretHash}',1,3,pg_temp.answers());`;
  expect(seed).toContain(save);
  seed = seed.replace(save, `
select * from public.ap_register_anonymous_document('${id(2)}','${original.secretHash}',1,'${id(80)}','RESUME','fixture.pdf','anonymous/${id(2)}/resume/fixture.pdf',128,'application/pdf','application/pdf',repeat('1',64));
select public.ap_record_isolated_document_review('${id(2)}','${id(80)}',repeat('1',64),'isolated-extractor-v1','["Worked as a receptionist at Fictional Salon."]');
insert into public.ap_candidate_facts(id,draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value)
values('${id(81)}','${id(2)}','annotated:EMPLOYMENT:fixture','EMPLOYMENT','{"employer":"Fictional Salon","historicalTitle":"Receptionist"}','DOCUMENT','${id(80)}','Fixture page1','EXTRACTED_UNCONFIRMED','fixture-v1','fixture-v1','SEARCH_CRITICAL','Employment','{"summary":"Receptionist at Fictional Salon"}');
select * from public.ap_save_four_step_draft('${id(2)}','${original.secretHash}',2,3,pg_temp.answers()||'{"entryMode":"CURRENT_RESUME","factReviews":{"${id(81)}":"CONFIRM"}}');`);
  seed = seed.replace(`'${original.secretHash}',3,3,pg_temp.answers()||`, `'${original.secretHash}',4,3,pg_temp.answers()||`);
  await database.script(`${seed}\ncommit;`);
  await database.script(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    ('${id(90)}','authenticated','authenticated','clarification@example.invalid',now(),false,'{}','{}',now(),now()),
    ('${id(92)}','authenticated','authenticated','outsider@example.invalid',now(),false,'{}','{}',now(),now());`);
  const originalEvidence = () => database.sql(`select jsonb_build_object('snapshot',to_jsonb(s),'answers',d.answers,'receipt',d.confirmation_receipt,'document',to_jsonb(v),'fact',to_jsonb(f)) from public.ap_intake_snapshots s join public.ap_anonymous_drafts d on d.id=s.draft_id join public.ap_document_versions v on v.id='${id(80)}' join public.ap_candidate_facts f on f.id='${id(81)}' where s.id='${id(3)}'`, true);
  const before = await originalEvidence();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("APP_DEPLOYMENT_ENV", "staging"); vi.stubEnv("APP_ANONYMOUS_DRAFT_SESSION_SECONDS", "86400");
  vi.stubEnv("APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED", "true"); vi.stubEnv("APP_KMS_KEY_IDENTITY", "fixture-kms"); vi.stubEnv("APP_KMS_KEY_VERSION", "1"); vi.stubEnv("APP_KMS_ENCRYPTION_CONTEXT_VERSION", "fixture-v1");
  // Actual atomic create/claim and explicit account selection, with a deliberately
  // discarded first create response. No synthetic account-claim inserts are used.
  boundary.cookie = ""; boundary.selectedId = "";
  const startInput = { action: "START", requestId: id(91), expectedBrowserDraftId: null };
  const started = await accessAction(post("/access", startInput));
  const startedBody = await result(started, 200, database.failures);
  const replay = await accessAction(post("/access", startInput));
  expect(await result(replay, 200, database.failures)).toEqual({ state: "RESUME_REQUIRED", rootDraftId: startedBody.draftId });
  expect(replay.headers.has("set-cookie")).toBe(false);
  const listed = await result(await accessList(), 200, database.failures);
  const created = listed.drafts.find((item: { draftId: string }) => item.draftId === startedBody.draftId);
  expect(listed.current).toBeNull(); expect(created.accessEmail).toBe("clarification@example.invalid");
  const resumed = await accessAction(post("/access", { action: "RESUME", rootDraftId: created.rootDraftId, expectedDraftId: created.draftId,
    expectedCapabilityVersion: created.capabilityVersion, expectedBrowserDraftId: null }));
  await result(resumed, 200, database.failures); selectCookie(resumed);
  const createdCookie = boundary.cookie;
  expect((await result(await readDraft(), 200, database.failures)).draft.answers.email).toBe("clarification@example.invalid");
  boundary.verified = false; expect((await result(await readDraft(), 200, database.failures)).draft).toBeNull(); boundary.verified = true;
  boundary.userId = id(92); boundary.email = "outsider@example.invalid";
  expect((await result(await readDraft(), 200, database.failures)).draft).toBeNull();
  boundary.userId = id(90); boundary.email = "clarification@example.invalid";
  boundary.selectedId = original.draftId; expect((await result(await readDraft(), 200, database.failures)).draft).toBeNull();
  boundary.cookie = serializeDraftCapability(original); boundary.selectedId = original.draftId;
  await result(await accessAction(post("/access", { action: "CLAIM", expectedBrowserDraftId: original.draftId })), 200, database.failures);
  expect(await originalEvidence()).toEqual(before);
  await database.script(`update auth.users set email='current-clarification@example.invalid' where id='${id(90)}';`);
  boundary.email = "current-clarification@example.invalid";
  const owned = await result(await accessList(), 200, database.failures);
  expect(owned.current).toMatchObject({ accessEmail: "clarification@example.invalid", verifiedEmail: boundary.email, draftId: original.draftId });
  expect(createdCookie).not.toBe(boundary.cookie);
  const issued = await result(await issueQuestion(post("/api/admin/matching-research", { action: "QUESTION", snapshotId: id(3), jobSnapshotId: id(10), nodeId: id(11), prompt: "Which appointment tools did you personally use at the salon?" })), 201, database.failures);
  const questionId = issued.questionId as string;
  expect((await result(await questions(), 200, database.failures)).questions).toContainEqual({ id: questionId, prompt: "Which appointment tools did you personally use at the salon?", answered: false, review_required: false });
  const answer = "I answered calls and booked appointments in a paper calendar; I did not analyze student data.";
  const savedResponse = await answerQuestion(post("/questions", { questionId, answer, confirmed: true }));
  const saved = await result(savedResponse, 201, database.failures); expect(saved.state).toBe("FULL_REVIEW_REQUIRED");
  expect(savedResponse.headers.get("set-cookie")).toContain("HttpOnly");
  // Discard the first Set-Cookie as if the response never reached the browser.
  expect((await result(await questions(), 200, database.failures)).questions[0]).toMatchObject({ answered: true, review_required: true });
  const recoveredResponse = await answerQuestion(post("/questions", { action: "RESUME", questionId }));
  const recovered = await result(recoveredResponse, 200, database.failures); expect(recovered.draftId).toBe(saved.draftId); expect(recovered.replayed).toBe(true);
  const wrongCustomer = await answerCustomerQuestion(post("/customer/questions", { action: "RESUME", questionId }));
  await result(wrongCustomer, 409, database.failures); expect(wrongCustomer.headers.has("set-cookie")).toBe(false);
  const successorCookie = decodeURIComponent(recoveredResponse.headers.get("set-cookie")!.split(";", 1)[0].split("=").slice(1).join("="));
  expect(parseDraftCapability(successorCookie)?.draftId).toBe(saved.draftId);
  expect(successorCookie).not.toContain(original.secret); expect(JSON.stringify(recovered)).not.toContain(parseDraftCapability(successorCookie)!.secret);
  boundary.cookie = serializeDraftCapability(createDraftCapability());
  await result(await answerQuestion(post("/questions", { action: "RESUME", questionId })), 404, database.failures);
  boundary.cookie = successorCookie;
  boundary.selectedId = saved.draftId;
  let draft = (await result(await readDraft(), 200, database.failures)).draft;
  expect(draft.confirmedIntake).toBe(false); expect(draft.finalizedSnapshotId).toBeNull();
  expect(draft.documents).toEqual([expect.objectContaining({ id: id(80), name: "fixture.pdf", processingState: "REVIEW_READY" })]);
  // Isolated extraction retains its text fact alongside the structured row.
  expect(draft.facts).toHaveLength(2);
  expect(draft.facts.every((fact: { id: string; documentVersionId: string }) => fact.id !== id(81) && fact.documentVersionId === id(80))).toBe(true);
  expect(await database.sql(`select count(*)::int from public.ap_candidate_answers where question_id='${questionId}'`, true)).toBe(0);
  await result(await answerQuestion(post("/questions", { questionId, answer: "Replace the saved answer without full review.", confirmed: true })), 409, database.failures);
  const full: FourStepDraft = { ...structuredClone(emptyFourStepDraft), entryMode: "CURRENT_RESUME", fullName: "Fictional Customer", email: "clarification@example.invalid", documentContactEmail: "documents@example.invalid",
    backgroundReviewed: true, desiredActivities: ["SUPPORTING_CUSTOMERS"], workModes: ["REMOTE"], stateOrDc: "VA", employmentTypes: ["FULL_TIME"], termsAccepted: true,
    factReviews: Object.fromEntries(draft.facts.map((fact: { id: string }) => [fact.id, "CONFIRM"])), clarifications: [{ questionId, prompt: "Which appointment tools did you personally use at the salon?", answer }] };
  full.employerUnknownPolicies = Object.fromEntries(hardEmployerCriteria(full).map(criterion => [criterion.key, "EXCLUDE_IF_UNKNOWN"]));
  draft = (await result(await saveDraft(post("/draft", { expectedVersion: draft.version, currentStep: 3, answers: full })), 200, database.failures)).draft;
  const presentAll = async () => {
    for (const fact of draft.facts) await result(await presentFact(post("/fact-presentation", { expectedVersion: draft.version, factId: fact.id, controlId: `fact-${fact.id}` })), 200, database.failures);
  };
  await presentAll();
  let review = await result(await reviewDraft(post("/review", { expectedVersion: draft.version })), 200, database.failures);
  expect(JSON.stringify(review.sections)).toContain(answer); expect(JSON.stringify(review.sections)).toContain("Fictional Salon");
  expect(review.receipt.answersSha256).toMatch(/^[a-f0-9]{64}$/u);
  const finalize = (answers: FourStepDraft, confirmation: unknown = review.receipt) => finalizeDraft(post("/finalize", { expectedVersion: draft.version, answers: normalizedFourStepDraft(answers), confirmation, factsConfirmed: true }));
  await result(await finalize({ ...full, phone: "5550109999" }), 409, database.failures);
  const oldReceipt = review.receipt;
  full.phone = "5550101234";
  draft = (await result(await saveDraft(post("/draft", { expectedVersion: draft.version, currentStep: 3, answers: full })), 200, database.failures)).draft;
  await result(await finalize(full, oldReceipt), 409, database.failures);
  // Changing a saved answer invalidates the old complete-review receipt as well.
  full.clarifications![0].answer = "I answered calls and booked appointments in a paper calendar.";
  draft = (await result(await saveDraft(post("/draft", { expectedVersion: draft.version, currentStep: 3, answers: full })), 200, database.failures)).draft;
  const editRecovery = await result(await answerQuestion(post("/questions", { action: "RESUME", questionId })), 200, database.failures);
  expect(editRecovery.draftId).toBe(saved.draftId); expect(editRecovery.replayed).toBe(true);
  expect((await result(await readDraft(), 200, database.failures)).draft.answers.clarifications[0].answer).toBe(full.clarifications![0].answer);
  await presentAll();
  review = await result(await reviewDraft(post("/review", { expectedVersion: draft.version })), 200, database.failures);
  const completed = await result(await finalize(full), 201, database.failures);
  expect(completed.snapshotId).not.toBe(id(3));
  expect(await database.sql(`select jsonb_build_object('accessEmail',access_email_normalized,'documentEmail',document_contact_email) from public.ap_intake_snapshots where id='${completed.snapshotId}'`, true))
    .toEqual({ accessEmail: "clarification@example.invalid", documentEmail: "documents@example.invalid" });
  const binding = await database.sql(`select jsonb_build_object('snapshot',f.snapshot_id,'question',a.question_id,'parent',s.parent_snapshot_id,'answer',f.typed_value->>'statement') from public.ap_candidate_answers a join public.ap_candidate_facts f on f.id=a.fact_id join public.ap_intake_snapshots s on s.id=f.snapshot_id where a.question_id='${questionId}'`, true);
  expect(binding).toEqual({ snapshot: completed.snapshotId, question: questionId, parent: id(3), answer: full.clarifications![0].answer });
  expect(await originalEvidence()).toEqual(before);
  expect(await database.sql(`select to_jsonb(public.ap_research_snapshot_current('${completed.snapshotId}'))`, true)).toBe(true);
  const finalDraft = (await result(await readDraft(), 200, database.failures)).draft;
  expect(finalDraft.confirmedIntake).toBe(true); expect(finalDraft.finalizedSnapshotId).toBe(completed.snapshotId);
  await result(await saveDraft(post("/draft", { expectedVersion: finalDraft.version, currentStep: 3, answers: full })), 409, database.failures);
  await result(await answerQuestion(post("/questions", { action: "RESUME", questionId })), 409, database.failures);
  expect(await originalEvidence()).toEqual(before);
});
