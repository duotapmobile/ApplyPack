import { strict as assert } from "node:assert";
import { z } from "zod";
import { stableStringify } from "@/lib/domain/foundation";
import type { DraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { draftInstructions, draftOutputJsonSchema, draftOutputSchema, type DraftOutput } from "@/lib/documents/draft-output";

export const FICTIONAL_DRAFT_MODEL = "applypack-fictional-source-model-v1";
export const FICTIONAL_DRAFT_KEY = "synthetic-local-draft-provider-not-a-secret";
export const FICTIONAL_OUTPUT_CAP = 2048;

/** Fictional provider fixture. This is deterministic source-linked prose, not a
 * claim about real model quality. Never falls back to fetch or another origin. */
export function draftProviderFixture(packet: Pick<DraftingEvidencePacket, "providerView">) {
  assert.equal(packet.providerView.background.noPriorEmployment, true);
  const capability = (task: string) => {
    const matches = packet.providerView.facts.filter(fact => fact.kind === "CAPABILITY_STATUS"
      && fact.value.task === task && fact.value.status === "CAN_DO_NOW"
      && fact.disposition === "CONFIRMED_SOURCE_NOT_APPROVED_PROSE" && fact.parentFactId === null);
    assert.equal(matches.length, 1, "exact confirmed unanchored capability required");
    const fact = matches[0];
    const taskAtoms = fact.atoms.filter(atom => atom.path === "/task" && atom.value === task && !atom.localRenderOnly);
    const statusAtoms = fact.atoms.filter(atom => atom.path === "/status" && atom.value === "CAN_DO_NOW" && !atom.localRenderOnly);
    assert.equal(taskAtoms.length, 1); assert.equal(statusAtoms.length, 1);
    return { factId: fact.id, atomIds: [taskAtoms[0].id, statusAtoms[0].id] };
  };
  const excel = capability("Excel"), recovery = capability("coordinate service recovery");
  assert.equal(packet.providerView.employerQuestionInsights.status, "OBSERVED");
  const questions = packet.providerView.employerQuestionInsights.questions.filter(question =>
    question.prompt === "Describe how you helped a customer solve a problem. Limit your response to 200 words.");
  assert.equal(questions.length, 1, "exact captured customer-recovery question required");
  const questionId = questions[0].id;
  const output: DraftOutput = draftOutputSchema.parse({ schemaVersion: "applypack-draft-proposal-v1", language: "en-US",
    resume: { summary: [], skills: [
      { text: "I can use Excel.", sourceAtomIds: excel.atomIds, jobEvidenceIds: [], questionIds: [], relation: "DIRECT" },
      { text: "I can coordinate service recovery.", sourceAtomIds: recovery.atomIds, jobEvidenceIds: [], questionIds: [questionId], relation: "DIRECT" },
    ], sections: [], educationFactIds: [] },
    coverLetter: { body: [{ sentences: [
      { text: "I can coordinate service recovery.", sourceAtomIds: recovery.atomIds, jobEvidenceIds: [], questionIds: [questionId], relation: "DIRECT" },
    ] }] } });
  // The captured question influences emphasis only. It does not establish a
  // past customer incident, student-data experience, a prior job or an answer.
  const countBody = { model: FICTIONAL_DRAFT_MODEL, instructions: draftInstructions(),
    input: [{ role: "user", content: [{ type: "input_text", text: stableStringify(packet.providerView) }] }],
    text: { format: { type: "json_schema", name: "applypack_draft_proposal", strict: true, schema: draftOutputJsonSchema } },
    tools: [], tool_choice: "none", truncation: "disabled" };
  const createBody = { ...countBody, store: false, background: false, stream: false, max_output_tokens: FICTIONAL_OUTPUT_CAP };
  const requests: Array<{ stage: "COUNT" | "GENERATE"; requestId: string }> = [];
  let requestId: string | null = null;
  const json = (body: unknown) => Response.json(body);
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(typeof input, "string");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.openai.com"); assert.equal(url.username, ""); assert.equal(url.password, "");
    assert.equal(url.search, ""); assert.equal(url.hash, "");
    assert.ok(init); assert.equal(init.method, "POST"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "omit"); assert.ok(init.signal); assert.equal(init.signal.aborted, false);
    const headers = new Headers(init.headers);
    assert.deepEqual([...headers.keys()].sort(), ["authorization", "content-type", "x-client-request-id"]);
    assert.equal(headers.get("authorization"), `Bearer ${FICTIONAL_DRAFT_KEY}`);
    assert.equal(headers.get("content-type"), "application/json");
    const id = z.uuid().parse(headers.get("x-client-request-id"));
    if (requestId === null) requestId = id; else assert.equal(id, requestId);
    assert.equal(typeof init.body, "string");
    const body: unknown = JSON.parse(String(init.body));
    assert.equal(init.body, JSON.stringify(body), "canonical body disallows duplicate JSON keys");
    if (requests.length === 0) {
      assert.equal(url.pathname, "/v1/responses/input_tokens"); assert.deepEqual(body, countBody);
      requests.push({ stage: "COUNT", requestId: id });
      return json({ object: "response.input_tokens", input_tokens: 1500 });
    }
    assert.equal(requests.length, 1, "one fictional generation only; no retries");
    assert.equal(url.pathname, "/v1/responses"); assert.deepEqual(body, createBody);
    requests.push({ stage: "GENERATE", requestId: id });
    return json({ id: "resp_FictionalApplyPackSource1", model: FICTIONAL_DRAFT_MODEL, status: "completed",
      usage: { input_tokens: 1500, output_tokens: 200, total_tokens: 1700 },
      output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  };
  return { fetchImpl, requests, output, questionId, capabilityFactIds: [excel.factId, recovery.factId],
    countBody, createBody, inputTokens: 1500, outputTokens: 200 };
}
