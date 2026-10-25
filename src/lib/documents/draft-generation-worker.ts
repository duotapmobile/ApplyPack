import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { deterministicUuid } from "@/lib/commerce/server";
import { serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";
import { serializeDraftProposal, validateDraftOutput } from "./draft-output";
import { requestOpenAiDraft, type DraftProviderUsage, type OpenAiDraftResult } from "./draft-provider-openai";
import type { DraftPayloadInput } from "./draft-packet-worker";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), timestamp = z.iso.datetime({ offset: true });
const claimSchema = z.object({ jobId: uuid, ownerId: uuid, leaseToken: uuid }).strict();
const runtimeSchema = z.object({ enabled: z.boolean(), policy_id: uuid.nullable() });
const stateSchema = z.object({ jobId: uuid, customerId: uuid, materialLineId: uuid, revisionId: uuid,
  revisionVersion: z.number().int().positive(), bindingSha256: hash, snapshotId: uuid, dueAt: timestamp,
  ownerId: uuid, leaseToken: uuid, leaseGeneration: z.number().int().positive(), leaseExpiresAt: timestamp,
  state: z.literal("READY"), versionId: uuid, packetPayloadId: uuid, packetSha256: hash, contextSha256: hash,
  sourcePayloadId: z.null(), invalidatedAt: z.null() }).strict();
const policySchema = z.object({ id: uuid, provider: z.literal("openai"), model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,119}$/u),
  policy_sha256: hash, privacy_reference_sha256: hash, evaluation_reference_sha256: hash, quote_reference_sha256: hash,
  max_input_tokens: z.number().int().min(1).max(50_000), max_output_tokens: z.number().int().min(16).max(16_000) });
const savedSchema = z.object({ jobId: uuid, customerId: uuid, materialLineId: uuid, versionId: uuid,
  requestId: uuid, packetSha256: hash, sourceSha256: hash, sourcePayloadId: uuid,
  attemptState: z.literal("RESULT_RECORDED"), invalidatedAt: z.null() }).strict();
export type DraftGenerationClaim = z.infer<typeof claimSchema>;
export type DraftGenerationState = z.infer<typeof stateSchema>;
export type DraftResponseObservation = {
  jobId: string; requestId: string; versionId: string; policyId: string;
  responseId: string | null; observedModel: string | null; usage: DraftProviderUsage | null;
  outcome: "PROPOSAL_VALIDATED" | "PROPOSAL_REJECTED" | "RESULT_UNKNOWN";
};
export type DraftGenerationServices = {
  readRuntime(signal: AbortSignal): Promise<unknown>;
  readState(claim: DraftGenerationClaim, signal: AbortSignal): Promise<unknown>;
  readPolicy(policyId: string, signal: AbortSignal): Promise<unknown>;
  loadPacket(state: DraftGenerationState, signal: AbortSignal): Promise<DraftingEvidencePacket>;
  renewLease(claim: DraftGenerationClaim, signal: AbortSignal): Promise<unknown>;
  readApiKey(): string;
  reserve(args: { p_job_id: string; p_lease_token: string; p_version_id: string; p_request_id: string; p_policy_id: string;
    p_input_token_cap: number; p_output_token_cap: number }, signal: AbortSignal): Promise<unknown>;
  recheck(args: { p_job_id: string; p_lease_token: string; p_request_id: string; p_version_id: string; p_policy_id: string }, signal: AbortSignal): Promise<unknown>;
  observe(observation: DraftResponseObservation, signal: AbortSignal): Promise<unknown>;
  storePayload(input: DraftPayloadInput, signal: AbortSignal): Promise<{ payloadId: string; sha256: string }>;
  recordSource(args: { p_job_id: string; p_lease_token: string; p_request_id: string; p_source_payload_id: string; p_source_sha256: string }, signal: AbortSignal): Promise<unknown>;
  readRecordedSource(jobId: string, requestId: string, signal: AbortSignal): Promise<unknown>;
  fail(claim: DraftGenerationClaim, signal: AbortSignal): Promise<unknown>;
};
export type DraftGenerationResult =
  | { status: "DISABLED" }
  | { status: "NOT_DISPATCHED"; code: string }
  | { status: "RESULT_UNKNOWN"; requestId: string; code: string }
  | { status: "SOURCE_READY"; requestId: string; versionId: string; sourceSha256: string; reconciled: boolean };
class WorkerError extends Error { constructor(readonly code: string) { super(code); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new WorkerError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value); ensure(result.success, code); return result.data;
}

/** One durable attempt, no retry loop. Services are server-only adapters, never
 * client-supplied callbacks. The DB reservation/recheck authorize the exact
 * active revision and policy; they remain required even after local validation.
 * This prepares an unapproved source pair, not files, approval or delivery. */
export async function generateDraftForClaim(services: DraftGenerationServices, raw: DraftGenerationClaim,
  options: { enabled: boolean; signal?: AbortSignal; now?: () => Date; fetchImpl?: typeof fetch } ): Promise<DraftGenerationResult> {
  if (!options.enabled) return { status: "DISABLED" };
  const controller = new AbortController(), signal = controller.signal, now = options.now ?? (() => new Date());
  const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 90_000);
  let requestId: string | null = null, reservationAttempted = false, dispatchConfirmed = false, sourceCommitAttempted = false;
  let claim: DraftGenerationClaim | null = null;
  const check = () => ensure(!signal.aborted && Number.isFinite(now().getTime()), "INTERRUPTED");
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    check(); let onAbort: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { onAbort = () => reject(new WorkerError("INTERRUPTED")); signal.addEventListener("abort", onAbort, { once: true }); });
    try { const result = await Promise.race([operation(), interrupted]); check(); return result; }
    finally { signal.removeEventListener("abort", onAbort); }
  }
  try {
    claim = parse(claimSchema, raw, "CLAIM_INVALID");
    const currentClaim = claim;
    const runtime = parse(runtimeSchema, await call(() => services.readRuntime(signal)), "RUNTIME_UNAVAILABLE");
    if (!runtime.enabled) return { status: "DISABLED" };
    ensure(runtime.policy_id, "POLICY_UNAVAILABLE");
    const state = parse(stateSchema, await call(() => services.readState(currentClaim, signal)), "CLAIM_STALE");
    ensure(state.jobId === claim.jobId && state.ownerId === claim.ownerId && state.leaseToken === claim.leaseToken
      && Date.parse(state.leaseExpiresAt) > now().getTime() && Date.parse(state.dueAt) > now().getTime(), "CLAIM_STALE");
    const policy = parse(policySchema, await call(() => services.readPolicy(runtime.policy_id!, signal)), "POLICY_UNAVAILABLE");
    ensure(policy.id === runtime.policy_id, "POLICY_MISMATCH");
    const packet = structuredClone(await call(() => services.loadPacket(state, signal)));
    const packetBytes = serializeDraftingEvidencePacket(packet);
    ensure(createHash("sha256").update(packetBytes, "utf8").digest("hex") === state.packetSha256
      && packet.packetSha256 === state.packetSha256 && packet.expected.customerId === state.customerId
      && packet.expected.materialLineId === state.materialLineId && packet.expected.revisionId === state.revisionId
      && packet.expected.revisionVersion === state.revisionVersion && packet.expected.bindingSha256 === state.bindingSha256
      && packet.binding.snapshotId === state.snapshotId && packet.binding.dueAt === state.dueAt
      && Date.parse(packet.validUntil) > now().getTime(), "PACKET_MISMATCH");
    const renewed = parse(timestamp, await call(() => services.renewLease(currentClaim, signal)), "LEASE_UNCONFIRMED");
    ensure(Date.parse(renewed) > now().getTime(), "LEASE_UNCONFIRMED");
    const apiKey = services.readApiKey();
    requestId = randomUUID();
    const currentRequest = requestId;
    const transport = await requestOpenAiDraft({ runtimeEnabled: true, apiKey, requestId, model: policy.model,
      policySha256: policy.policy_sha256, maxInputTokens: policy.max_input_tokens, maxOutputTokens: policy.max_output_tokens,
      evidence: packet, signal, now, fetchImpl: options.fetchImpl,
      reserveDispatch: () => { reservationAttempted = true; return call(() => services.reserve({ p_job_id: state.jobId,
        p_lease_token: currentClaim.leaseToken, p_version_id: state.versionId, p_request_id: currentRequest,
        p_policy_id: policy.id, p_input_token_cap: policy.max_input_tokens, p_output_token_cap: policy.max_output_tokens }, signal)); },
      recheckDispatch: async () => await call(() => services.recheck({ p_job_id: state.jobId, p_lease_token: currentClaim.leaseToken,
        p_request_id: currentRequest, p_version_id: state.versionId, p_policy_id: policy.id }, signal)) === true,
    });
    if (transport.outcome === "NOT_DISPATCHED") throw new WorkerError(transport.code);
    dispatchConfirmed = true;
    const observe = async (outcome: DraftResponseObservation["outcome"], result: Exclude<OpenAiDraftResult, { outcome: "NOT_DISPATCHED" }>) => {
      const usage = result.usage && result.usage.inputTokens + result.usage.outputTokens === result.usage.totalTokens ? result.usage : null;
      const receipt = await call(() => services.observe({ jobId: state.jobId, requestId: currentRequest, versionId: state.versionId,
        policyId: policy.id, responseId: result.responseId ?? null,
        observedModel: result.outcome === "COMPLETED" ? result.model : result.observedModel ?? null, usage, outcome }, signal));
      parse(hash, receipt, "OBSERVATION_UNCONFIRMED");
    };
    if (transport.outcome === "RESULT_UNKNOWN") { await observe("RESULT_UNKNOWN", transport); throw new WorkerError(transport.code); }
    let proposal: ReturnType<typeof validateDraftOutput>;
    try { proposal = validateDraftOutput(transport.output, packet, now()); }
    catch { await observe("PROPOSAL_REJECTED", transport); throw new WorkerError("PROPOSAL_REJECTED"); }
    const source = serializeDraftProposal(proposal);
    ensure(createHash("sha256").update(source, "utf8").digest("hex") === proposal.sourceSha256, "SOURCE_DIGEST_INVALID");
    const payloadId = deterministicUuid(`applypack:draft-source:${state.jobId}:${requestId}:${proposal.sourceSha256}`);
    const stored = await call(() => services.storePayload({ customerId: state.customerId, jobId: state.jobId, payloadId,
      purpose: "MATERIAL_DRAFT_SOURCE", body: source, sha256: proposal.sourceSha256 }, signal));
    ensure(stored.payloadId === payloadId && stored.sha256 === proposal.sourceSha256, "SOURCE_PERSIST_UNCONFIRMED");
    await observe("PROPOSAL_VALIDATED", transport);
    ensure(Date.parse(packet.validUntil) > now().getTime(), "EVIDENCE_EXPIRED");
    sourceCommitAttempted = true;
    let acknowledged = false;
    try {
      const receipt = await call(() => services.recordSource({ p_job_id: state.jobId, p_lease_token: currentClaim.leaseToken,
        p_request_id: currentRequest, p_source_payload_id: payloadId, p_source_sha256: proposal.sourceSha256 }, signal));
      acknowledged = receipt === state.versionId;
    } catch { /* Reconcile by immutable identities; do not repeat or delete. */ }
    const saved = parse(savedSchema, await call(() => services.readRecordedSource(state.jobId, currentRequest, signal)), "SOURCE_RESULT_UNKNOWN");
    ensure(saved.jobId === state.jobId && saved.customerId === state.customerId && saved.materialLineId === state.materialLineId
      && saved.versionId === state.versionId && saved.requestId === currentRequest && saved.packetSha256 === state.packetSha256
      && saved.sourceSha256 === proposal.sourceSha256 && saved.sourcePayloadId === payloadId, "SOURCE_IDENTITY_MISMATCH");
    return { status: "SOURCE_READY", requestId, versionId: state.versionId, sourceSha256: proposal.sourceSha256, reconciled: !acknowledged };
  } catch (error) {
    const code = error instanceof WorkerError ? error.code : "UNCONFIRMED";
    if (reservationAttempted && requestId) {
      // A committed source must never become an owner exception because its
      // response was lost. The claim/reconciliation path will inspect it later.
      if (dispatchConfirmed && !sourceCommitAttempted && claim && !signal.aborted) {
        try { await call(() => services.fail(claim!, signal)); } catch { /* Reserved spend remains conservatively unresolved. */ }
      }
      return { status: "RESULT_UNKNOWN", requestId, code };
    }
    return { status: "NOT_DISPATCHED", code };
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); controller.abort(); }
}
