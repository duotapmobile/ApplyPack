import "server-only";
import { z } from "zod";
import { canonicalSha256, stableStringify } from "@/lib/domain/foundation";
import { draftInstructions, draftOutputJsonSchema, draftOutputSchema, type DraftOutput, type DraftOutputEvidence } from "./draft-output";
import { draftChangeProviderContextSchema, type DraftChangeProviderContext } from "./draft-change-request";

const BASE = "https://api.openai.com/v1/responses";
const permitSchema = z.object({ requestId: z.uuid(), dispatchAuthorized: z.literal(true), state: z.literal("DISPATCHED"),
  reservedMicrousd: z.number().int().positive(), provider: z.literal("openai"), model: z.string().min(1).max(120),
  policySha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const usageSchema = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() });
export type DraftProviderUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type OpenAiDraftResult =
  | { outcome: "COMPLETED"; requestId: string; responseId: string; model: string; output: DraftOutput; usage: DraftProviderUsage }
  | { outcome: "NOT_DISPATCHED"; code: "DISABLED" | "INPUT_INVALID" | "RESERVATION_UNCONFIRMED" }
  | { outcome: "RESULT_UNKNOWN"; requestId: string; code: string; responseId?: string; observedModel?: string; usage?: DraftProviderUsage };
type RequestInput = {
  runtimeEnabled: boolean; apiKey: string; requestId: string; model: string; policySha256: string;
  maxInputTokens: number; maxOutputTokens: number; evidence: DraftOutputEvidence;
  ownerChangeRequest?: DraftChangeProviderContext;
  /** Calls the durable DB reservation RPC exactly once. A replay receipt never
   * authorizes another provider request. Callers must use a fresh fenced lease. */
  reserveDispatch: () => Promise<unknown>;
  /** Read/lock the same attempt, active policy, source revision and lease after
   * counting. This does not reserve a second attempt or authorize a retry. */
  recheckDispatch: () => Promise<boolean>;
  signal?: AbortSignal; fetchImpl?: typeof fetch; now?: () => Date;
};
class TransportError extends Error {
  constructor(readonly code: string) { super(code); }
}
function requireThat(condition: unknown, code: string): asserts condition { if (!condition) throw new TransportError(code); }

async function readJson(response: Response, signal: AbortSignal, limit: number, interrupted: Promise<never>) {
  requireThat(response.ok && !response.redirected, "HTTP_UNCONFIRMED");
  requireThat(/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") || ""), "CONTENT_TYPE_INVALID");
  const length = response.headers.get("content-length");
  requireThat(length === null || /^\d+$/u.test(length) && Number(length) <= limit, "RESPONSE_TOO_LARGE");
  const reader = response.body?.getReader();
  requireThat(reader, "RESPONSE_EMPTY");
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw new TransportError("INTERRUPTED");
      const part = await Promise.race([reader.read(), interrupted]);
      if (part.done) break;
      bytes += part.value.byteLength;
      requireThat(bytes <= limit, "RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(part.value));
    }
    const body = Buffer.concat(chunks);
    try { return JSON.parse(body.toString("utf8")) as unknown; }
    catch { throw new TransportError("RESPONSE_JSON_INVALID"); }
    finally { body.fill(0); }
  } finally { chunks.forEach((chunk) => chunk.fill(0)); void reader.cancel().catch(() => undefined); }
}

/** Fixed-origin, no-tools, foreground adapter. It is not a worker scheduler or
 * provider authorization flow. It never retries a count, generation or lost
 * response. Default-disabled DB/runtime gates and an approved policy are caller
 * prerequisites. store:false does not claim zero provider retention. */
export async function requestOpenAiDraft(input: RequestInput): Promise<OpenAiDraftResult> {
  if (!input.runtimeEnabled) return { outcome: "NOT_DISPATCHED", code: "DISABLED" };
  let body: Record<string, unknown>;
  try {
    // Async reservation/count callbacks must not change which input or model
    // the already-checked request will use.
    input = { ...input, evidence: structuredClone(input.evidence),
      ...(input.ownerChangeRequest ? { ownerChangeRequest: draftChangeProviderContextSchema.parse(input.ownerChangeRequest) } : {}) };
    requireThat(z.uuid().safeParse(input.requestId).success && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,119}$/u.test(input.model)
      && /^[0-9a-f]{64}$/u.test(input.policySha256) && input.apiKey.length > 10 && !/[\r\n]/u.test(input.apiKey), "INPUT_INVALID");
    requireThat(Number.isInteger(input.maxInputTokens) && input.maxInputTokens >= 1 && input.maxInputTokens <= 50_000
      && Number.isInteger(input.maxOutputTokens) && input.maxOutputTokens >= 16 && input.maxOutputTokens <= 16_000, "INPUT_INVALID");
    requireThat(!input.signal?.aborted && Date.parse(input.evidence.validUntil) > (input.now?.() ?? new Date()).getTime()
      && canonicalSha256(input.evidence.providerView) === input.evidence.providerViewSha256, "INPUT_INVALID");
    body = { model: input.model, instructions: draftInstructions(),
      input: [{ role: "user", content: [{ type: "input_text", text: stableStringify(input.ownerChangeRequest
        ? { evidence: input.evidence.providerView, ownerRevisionRequest: input.ownerChangeRequest } : input.evidence.providerView) }] }],
      text: { format: { type: "json_schema", name: "applypack_draft_proposal", strict: true, schema: draftOutputJsonSchema } },
      tools: [], tool_choice: "none", truncation: "disabled" };
    requireThat(Buffer.byteLength(JSON.stringify(body), "utf8") <= 256_000, "INPUT_INVALID");
  } catch { return { outcome: "NOT_DISPATCHED", code: "INPUT_INVALID" }; }

  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) controller.abort();
  const interrupted = new Promise<never>((_, reject) => {
    const fail = () => reject(new TransportError("INTERRUPTED"));
    if (controller.signal.aborted) fail(); else controller.signal.addEventListener("abort", fail, { once: true });
  });
  void interrupted.catch(() => undefined);
  // One deadline includes reservation, both authorization checks, count,
  // generation, response headers and body. An unknown reservation never retries.
  const timer = setTimeout(abort, 45_000);
  const fetcher = input.fetchImpl ?? fetch;
  let reservationConfirmed = false;
  let responseId: string | undefined, observedModel: string | undefined, usage: DraftProviderUsage | undefined;
  const post = async (url: string, value: Record<string, unknown>, limit: number) => {
    if (controller.signal.aborted) throw new TransportError("INTERRUPTED");
    const response = await Promise.race([fetcher(url, { method: "POST", redirect: "error", cache: "no-store", credentials: "omit",
      headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}`, "X-Client-Request-Id": input.requestId },
      body: JSON.stringify(value), signal: controller.signal }), interrupted]);
    return readJson(response, controller.signal, limit, interrupted);
  };
  try {
    const permit = permitSchema.parse(await Promise.race([input.reserveDispatch(), interrupted]));
    requireThat(permit.requestId === input.requestId && permit.model === input.model
      && permit.policySha256 === input.policySha256, "RESERVATION_UNCONFIRMED");
    reservationConfirmed = true;
    // Counting also transmits private evidence. Recheck authorization and
    // freshness before the first transmission, as well as before generation.
    requireThat(await Promise.race([input.recheckDispatch(), interrupted]) === true, "DISPATCH_NO_LONGER_CURRENT");
    requireThat(Date.parse(input.evidence.validUntil) > (input.now?.() ?? new Date()).getTime(), "EVIDENCE_EXPIRED");
    const count = z.object({ object: z.literal("response.input_tokens"), input_tokens: z.number().int().nonnegative() }).strict()
      .safeParse(await post(`${BASE}/input_tokens`, body, 4096));
    requireThat(count.success && count.data.input_tokens <= input.maxInputTokens, "INPUT_TOKEN_CAP_EXCEEDED");
    requireThat(await Promise.race([input.recheckDispatch(), interrupted]) === true, "DISPATCH_NO_LONGER_CURRENT");
    requireThat(Date.parse(input.evidence.validUntil) > (input.now?.() ?? new Date()).getTime(), "EVIDENCE_EXPIRED");
    const response = await post(BASE, { ...body, store: false, background: false, stream: false, max_output_tokens: input.maxOutputTokens }, 512_000);
    const envelope = z.object({ id: z.string().regex(/^resp_[A-Za-z0-9_-]{1,160}$/), model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,119}$/u), status: z.string(),
      output: z.array(z.unknown()).max(16), usage: usageSchema }).safeParse(response);
    requireThat(envelope.success, "RESPONSE_SHAPE_INVALID");
    responseId = envelope.data.id;
    observedModel = envelope.data.model;
    usage = { inputTokens: envelope.data.usage.input_tokens, outputTokens: envelope.data.usage.output_tokens, totalTokens: envelope.data.usage.total_tokens };
    requireThat(usage.inputTokens + usage.outputTokens === usage.totalTokens && usage.inputTokens <= input.maxInputTokens
      && usage.outputTokens <= input.maxOutputTokens, "USAGE_POLICY_EXCEEDED");
    requireThat(envelope.data.model === input.model, "MODEL_MISMATCH");
    requireThat(envelope.data.status === "completed", "RESPONSE_INCOMPLETE");
    const messages = envelope.data.output.filter((value) => {
      const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
      requireThat(item.type === "message" || item.type === "reasoning", "UNEXPECTED_PROVIDER_ACTION");
      return item.type === "message";
    });
    requireThat(messages.length === 1, "RESPONSE_MESSAGE_INVALID");
    const message = z.object({ type: z.literal("message"), role: z.literal("assistant"), status: z.literal("completed"),
      content: z.array(z.unknown()).length(1) }).safeParse(messages[0]);
    requireThat(message.success, "RESPONSE_MESSAGE_INVALID");
    const content = z.object({ type: z.literal("output_text"), text: z.string().max(180_000) }).safeParse(message.data.content[0]);
    requireThat(content.success, "REFUSED_OR_OUTPUT_INVALID");
    let parsed: unknown;
    try { parsed = JSON.parse(content.data.text); } catch { throw new TransportError("OUTPUT_JSON_INVALID"); }
    const output = draftOutputSchema.safeParse(parsed);
    requireThat(output.success, "OUTPUT_SHAPE_INVALID");
    requireThat(Date.parse(input.evidence.validUntil) > (input.now?.() ?? new Date()).getTime(), "EVIDENCE_EXPIRED");
    return { outcome: "COMPLETED", requestId: input.requestId, responseId, model: envelope.data.model, output: output.data, usage };
  } catch (error) {
    if (!reservationConfirmed) return { outcome: "NOT_DISPATCHED", code: "RESERVATION_UNCONFIRMED" };
    return { outcome: "RESULT_UNKNOWN", requestId: input.requestId,
      code: error instanceof TransportError ? error.code : "TRANSPORT_UNCONFIRMED", ...(responseId ? { responseId } : {}),
      ...(observedModel ? { observedModel } : {}), ...(usage ? { usage } : {}) };
  } finally { clearTimeout(timer); input.signal?.removeEventListener("abort", abort); controller.abort(); }
}
