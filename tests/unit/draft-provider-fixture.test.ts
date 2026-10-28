import { describe, expect, it, vi } from "vitest";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { draftDocumentFixture } from "../fixtures/draft-document";
import { draftProviderFixture, FICTIONAL_DRAFT_KEY } from "../integration/draft-provider-fixture";

vi.mock("server-only", () => ({}));

// Synthetic records test the transport boundary only.
// The native parent supplies the actual persisted packet instead.
function fixture() {
  const packet = structuredClone(draftDocumentFixture("VOLUNTEER", "Completed", true).input.packet);
  packet.providerView.background.noPriorEmployment = true;
  packet.providerView.facts = ["Excel", "coordinate service recovery"].map((task, index) => {
    const id = `a1190000-0000-4000-8000-00000000000${index + 1}`, value = { task, status: "CAN_DO_NOW" };
    return { id, kind: "CAPABILITY_STATUS", value, valueSha256: canonicalSha256(value),
      disposition: "CONFIRMED_SOURCE_NOT_APPROVED_PROSE" as const, parentFactId: null, datePrecision: "NOT_SPECIFIED",
      atoms: Object.entries(value).map(([key, source]) => ({ id: canonicalSha256({ id, key, source }), factId: id,
        path: `/${key}`, value: source, localRenderOnly: false })) };
  });
  const [question] = packet.providerView.employerQuestionInsights.questions;
  expect(question).toBeDefined();
  question.prompt = "Describe how you helped a customer solve a problem. Limit your response to 200 words.";
  packet.providerView.employerQuestionInsights.questions = [question];
  packet.providerView.employerQuestionInsights.status = "OBSERVED";
  const transport = draftProviderFixture(packet), requestId = "a1190000-0000-4000-8000-000000000090";
  const init = (body: unknown): RequestInit => ({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
    signal: new AbortController().signal, headers: { "content-type": "application/json", authorization: `Bearer ${FICTIONAL_DRAFT_KEY}`,
      "X-Client-Request-Id": requestId }, body: JSON.stringify(body) });
  return { packet, transport, init, requestId };
}

describe("finite no-network fictional draft provider", () => {
  it("returns one bounded response from exact confirmed capability atoms and the actual question ID", async () => {
    const f = fixture();
    expect(await (await f.transport.fetchImpl("https://api.openai.com/v1/responses/input_tokens", f.init(f.transport.countBody))).json())
      .toEqual({ object: "response.input_tokens", input_tokens: 1500 });
    const result = await (await f.transport.fetchImpl("https://api.openai.com/v1/responses", f.init(f.transport.createBody))).json();
    expect(result.status).toBe("completed"); expect(result.usage).toEqual({ input_tokens: 1500, output_tokens: 200, total_tokens: 1700 });
    expect(f.transport.output.resume.sections).toEqual([]); expect(f.transport.output.resume.educationFactIds).toEqual([]);
    expect(f.transport.output.coverLetter.body[0].sentences[0].questionIds).toEqual([f.packet.providerView.employerQuestionInsights.questions[0].id]);
    expect(JSON.stringify(f.transport.output)).not.toMatch(/student assessment|employed|years|\d+%/u);
    await expect(f.transport.fetchImpl("https://api.openai.com/v1/responses", f.init(f.transport.createBody))).rejects.toThrow();
    expect(f.transport.requests).toHaveLength(2);
  });
  it.each(["https://other.invalid/v1/responses/input_tokens", "http://api.openai.com/v1/responses/input_tokens",
    "https://api.openai.com/v1/responses", "https://api.openai.com/v1/responses/input_tokens?extra=1",
    "https://api.openai.com/v1/responses/input_tokens#ignored", "https://user@api.openai.com/v1/responses/input_tokens"])("rejects unmodeled endpoint %s", async url => {
    const f = fixture(); await expect(f.transport.fetchImpl(url, f.init(f.transport.countBody))).rejects.toThrow();
    expect(f.transport.requests).toHaveLength(0);
  });
  it.each(["tools", "tool_choice", "truncation", "model", "metadata", "previous_response_id"])("rejects changed or extra %s", async field => {
    const f = fixture(); await expect(f.transport.fetchImpl("https://api.openai.com/v1/responses/input_tokens",
      f.init({ ...f.transport.countBody, [field]: "unapproved" }))).rejects.toThrow();
  });
  it.each(["store", "background", "stream", "max_output_tokens"])("rejects changed generation %s", async field => {
    const f = fixture(); await f.transport.fetchImpl("https://api.openai.com/v1/responses/input_tokens", f.init(f.transport.countBody));
    await expect(f.transport.fetchImpl("https://api.openai.com/v1/responses", f.init({ ...f.transport.createBody, [field]: true }))).rejects.toThrow();
  });
  it("rejects different request identity, changed evidence and duplicate JSON keys", async () => {
    const f = fixture(); await f.transport.fetchImpl("https://api.openai.com/v1/responses/input_tokens", f.init(f.transport.countBody));
    const changed = f.init(f.transport.createBody); changed.headers = { ...changed.headers, "X-Client-Request-Id": "a1190000-0000-4000-8000-000000000091" };
    await expect(f.transport.fetchImpl("https://api.openai.com/v1/responses", changed)).rejects.toThrow();
    await expect(f.transport.fetchImpl("https://api.openai.com/v1/responses", f.init({ ...f.transport.createBody, input: [] }))).rejects.toThrow();
    const duplicate = f.init(f.transport.createBody); duplicate.body = String(duplicate.body).replace('"store":false', '"store":true,"store":false');
    await expect(f.transport.fetchImpl("https://api.openai.com/v1/responses", duplicate)).rejects.toThrow();
  });
  it("refuses to invent support when the capability is missing, limited or negative", () => {
    for (const status of ["NOT_DONE", "UNSURE", "BASIC_EXPOSURE"]) {
      const f = fixture(); f.packet.providerView.facts[0].value.status = status;
      expect(() => draftProviderFixture(f.packet)).toThrow();
    }
    const f = fixture(); f.packet.providerView.facts = []; expect(() => draftProviderFixture(f.packet)).toThrow();
  });
});
