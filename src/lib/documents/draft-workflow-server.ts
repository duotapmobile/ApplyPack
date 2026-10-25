import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { createDraftPacketServices, readEncryptedDraftPayload, storeEncryptedDraftPayload, type DraftPacketWorkflowPort } from "./draft-packet-worker";
import { loadDraftingEvidencePacket } from "./drafting-evidence-server";
import { draftingEvidenceExpectationSchema, serializeDraftingEvidencePacket } from "./drafting-evidence";
import type { DraftGenerationServices } from "./draft-generation-worker";

type Admin = SupabaseClient<Database>;
type ObservationArgs = Database["public"]["Functions"]["ap_observe_material_draft_response"]["Args"];
type NullableObservationKeys = "p_provider_response_id" | "p_response_model" | "p_input_tokens" | "p_output_tokens" | "p_total_tokens";
type SqlObservationArgs = Omit<ObservationArgs, NullableObservationKeys> & { [Key in NullableObservationKeys]: ObservationArgs[Key] | null };
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const claimSchema = z.object({ jobId: uuid, ownerId: uuid, leaseToken: uuid }).strict();
const jobColumns = "id,customer_id,material_line_id,line_revision_id,source_snapshot_id,state,active_version_id,lease_owner,lease_token,lease_generation,lease_expires_at";
const versionColumns = "id,job_id,customer_id,material_line_id,packet_encrypted_payload_id,packet_sha256,context_sha256,encrypted_payload_id,source_sha256,invalidated_at";
const jobSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid, source_snapshot_id: uuid,
  state: z.enum(["EVIDENCE_PENDING", "PREPARING", "READY", "DRAFTING", "SOURCE_READY", "RENDERING", "REVIEW_READY", "APPROVED", "RELEASED", "RESULT_UNKNOWN", "OWNER_EXCEPTION", "SUPERSEDED", "CANCELED"]),
  active_version_id: uuid.nullable(), lease_owner: uuid.nullable(), lease_token: uuid.nullable(), lease_generation: z.number().int().nonnegative(), lease_expires_at: time.nullable() }).strict();
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, packet_encrypted_payload_id: uuid,
  packet_sha256: hash, context_sha256: hash, encrypted_payload_id: uuid.nullable(), source_sha256: hash.nullable(), invalidated_at: time.nullable() }).strict();
const revisionSchema = z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, version: z.number().int().positive(), binding_sha256: hash, due_at: time, superseded_at: z.null() }).strict();
const runtimeSchema = z.object({ singleton: z.literal(true), enabled: z.boolean(), policy_id: uuid.nullable() }).strict();
const policySchema = z.object({ id: uuid, provider: z.literal("openai"), model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,119}$/),
  policy_sha256: hash, privacy_reference_sha256: hash, evaluation_reference_sha256: hash, quote_reference_sha256: hash,
  max_input_tokens: z.number().int().min(1).max(50_000), max_output_tokens: z.number().int().min(16).max(16_000) }).strict();
const attemptSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, draft_version_id: uuid, state: z.literal("RESULT_RECORDED") }).strict();
const payloadSchema = z.object({ id: uuid, customer_id: uuid, content_sha256: hash, retention_state: z.literal("ACTIVE") }).strict();
const leaseArgs = z.object({ p_job_id: uuid, p_lease_token: uuid }).strict();
const dispatchArgs = leaseArgs.extend({ p_request_id: uuid, p_version_id: uuid, p_policy_id: uuid }).strict();
const stateSchema = z.object({ jobId: uuid, customerId: uuid, materialLineId: uuid, revisionId: uuid, revisionVersion: z.number().int().positive(),
  bindingSha256: hash, snapshotId: uuid, dueAt: time, ownerId: uuid, leaseToken: uuid, leaseGeneration: z.number().int().positive(),
  leaseExpiresAt: time, state: z.literal("READY"), versionId: uuid, packetPayloadId: uuid, packetSha256: hash, contextSha256: hash,
  sourcePayloadId: z.null(), invalidatedAt: z.null() }).strict();

export class DraftWorkflowServerError extends Error {
  constructor(readonly code: string) { super(`DRAFT_WORKFLOW_${code}`); this.name = "DraftWorkflowServerError"; }
}
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftWorkflowServerError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code = "RECEIPT_INVALID"): T {
  const result = schema.safeParse(value); ensure(result.success, code); return result.data;
}
function sameVersion(job: z.infer<typeof jobSchema>, version: z.infer<typeof versionSchema>) {
  ensure(job.active_version_id === version.id && version.job_id === job.id && version.customer_id === job.customer_id
    && version.material_line_id === job.material_line_id && version.invalidated_at === null, "VERSION_STALE");
}

/** Service-only adapter; never expose these methods as customer Server Actions.
 * Construct per worker invocation. Creation performs no query, reads no API key,
 * and starts no work. The caller still owns scheduling and provider activation.
 * The generated Database contract is authoritative; no local RPC type aliases
 * or untyped client fallback are used for the 091 database surface. */
export function createDraftWorkflowServer(admin: Admin, options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());
  const enabled = () => process.env.APP_MATERIAL_DRAFTING_ENABLED === "true";
  let runtimePolicy: string | null = null, approvedPolicy: string | null = null;
  async function bounded<T>(external: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    ensure(!external.aborted, "ABORTED");
    const controller = new AbortController(), abort = () => controller.abort();
    external.addEventListener("abort", abort, { once: true });
    if (external.aborted) controller.abort();
    const timer = setTimeout(abort, 20_000);
    let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => {
      stop = () => reject(new DraftWorkflowServerError("ABORTED"));
      if (controller.signal.aborted) stop(); else controller.signal.addEventListener("abort", stop, { once: true });
    });
    try {
      const result = await Promise.race([operation(controller.signal), interrupted]);
      ensure(!controller.signal.aborted, "ABORTED"); return result;
    } catch (error) {
      if (error instanceof DraftWorkflowServerError) throw error;
      throw new DraftWorkflowServerError("UNCONFIRMED");
    } finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); controller.abort(); }
  }
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted, "ABORTED"); const result = await query;
    ensure(!signal.aborted, "ABORTED"); ensure(!result.error, "UNCONFIRMED"); return result.data;
  }
  const readJob = async (id: string, signal: AbortSignal) => {
    parse(uuid, id, "INPUT_INVALID");
    const row = parse(jobSchema, await data(admin.from("ap_material_draft_jobs").select(jobColumns).eq("id", id).abortSignal(signal).single(), signal));
    ensure(row.id === id, "JOB_IDENTITY_MISMATCH"); return row;
  };
  const readVersion = async (id: string, signal: AbortSignal) => {
    parse(uuid, id, "INPUT_INVALID");
    const row = parse(versionSchema, await data(admin.from("ap_material_draft_versions").select(versionColumns).eq("id", id).abortSignal(signal).single(), signal));
    ensure(row.id === id, "VERSION_IDENTITY_MISMATCH"); return row;
  };
  const context = async (id: string, signal: AbortSignal) => parse(hash,
    await data(admin.rpc("ap_material_draft_context_sha256", { p_job_id: id }).abortSignal(signal), signal));
  const renew = async (args: z.infer<typeof leaseArgs>, signal: AbortSignal) => {
    const value = parse(time, await data(admin.rpc("ap_renew_material_draft_lease", parse(leaseArgs, args, "INPUT_INVALID")).abortSignal(signal), signal));
    ensure(Date.parse(value) > now().getTime(), "LEASE_STALE"); return value;
  };
  const workflow: DraftPacketWorkflowPort = {
    readJob: (id, signal) => bounded(signal, (child) => readJob(id, child)),
    readVersion: (id, signal) => bounded(signal, (child) => readVersion(id, child)),
    renewLease: (args, signal) => bounded(signal, (child) => renew(args, child)),
    readContext: (args, signal) => bounded(signal, (child) => context(parse(z.object({ p_job_id: uuid }).strict(), args, "INPUT_INVALID").p_job_id, child)),
    attach: (raw, signal) => bounded(signal, async (child) => {
      const args = parse(leaseArgs.extend({ p_payload_id: uuid, p_packet_sha256: hash, p_context_sha256: hash }).strict(), raw, "INPUT_INVALID");
      return parse(uuid, await data(admin.rpc("ap_attach_material_draft_packet", args).abortSignal(child), child));
    }),
  };
  const generation: DraftGenerationServices = {
    readRuntime: (signal) => bounded(signal, async (child) => {
      runtimePolicy = null; approvedPolicy = null;
      if (!enabled()) return { enabled: false, policy_id: null };
      const row = parse(runtimeSchema, await data(admin.from("ap_material_draft_runtime").select("singleton,enabled,policy_id").eq("singleton", true).abortSignal(child).single(), child));
      ensure(!row.enabled || row.policy_id !== null, "POLICY_UNAVAILABLE");
      runtimePolicy = row.enabled ? row.policy_id : null;
      return { enabled: row.enabled, policy_id: row.policy_id };
    }),
    readPolicy: (id, signal) => bounded(signal, async (child) => {
      approvedPolicy = null; parse(uuid, id, "INPUT_INVALID"); ensure(enabled() && runtimePolicy === id, "PROVIDER_DISABLED");
      const row = parse(policySchema, await data(admin.from("ap_material_draft_policies")
        .select("id,provider,model,policy_sha256,privacy_reference_sha256,evaluation_reference_sha256,quote_reference_sha256,max_input_tokens,max_output_tokens")
        .eq("id", id).abortSignal(child).single(), child));
      ensure(row.id === id && enabled() && runtimePolicy === id, "POLICY_IDENTITY_MISMATCH"); approvedPolicy = id; return row;
    }),
    readState: (raw, signal) => bounded(signal, async (child) => {
      const claim = parse(claimSchema, raw, "INPUT_INVALID"), job = await readJob(claim.jobId, child);
      ensure(job.state === "READY" && job.lease_owner === claim.ownerId && job.lease_token === claim.leaseToken && job.active_version_id
        && job.lease_expires_at && Date.parse(job.lease_expires_at) > now().getTime(), "CLAIM_STALE");
      const revision = parse(revisionSchema, await data(admin.from("ap_material_line_revisions")
        .select("id,line_id,source_snapshot_id,version,binding_sha256,due_at,superseded_at").eq("id", job.line_revision_id).abortSignal(child).single(), child));
      ensure(revision.id === job.line_revision_id && revision.line_id === job.material_line_id && revision.source_snapshot_id === job.source_snapshot_id
        && Date.parse(revision.due_at) > now().getTime(), "REVISION_STALE");
      const version = await readVersion(job.active_version_id, child); sameVersion(job, version);
      ensure(version.encrypted_payload_id === null && version.source_sha256 === null, "VERSION_STALE");
      ensure(await context(job.id, child) === version.context_sha256, "CONTEXT_CHANGED");
      ensure(JSON.stringify(await readJob(job.id, child)) === JSON.stringify(job), "CLAIM_CHANGED");
      return parse(stateSchema, { jobId: job.id, customerId: job.customer_id, materialLineId: job.material_line_id, revisionId: revision.id,
        revisionVersion: revision.version, bindingSha256: revision.binding_sha256, snapshotId: revision.source_snapshot_id, dueAt: revision.due_at,
        ownerId: job.lease_owner, leaseToken: job.lease_token, leaseGeneration: job.lease_generation, leaseExpiresAt: job.lease_expires_at,
        state: job.state, versionId: version.id, packetPayloadId: version.packet_encrypted_payload_id, packetSha256: version.packet_sha256,
        contextSha256: version.context_sha256, sourcePayloadId: null, invalidatedAt: null });
    }),
    loadPacket: (raw, signal) => bounded(signal, async (child) => {
      const state = parse(stateSchema, raw, "STATE_INVALID");
      const expected = { customerId: state.customerId, materialLineId: state.materialLineId, revisionId: state.revisionId,
        revisionVersion: state.revisionVersion, bindingSha256: state.bindingSha256 };
      let plaintext: Buffer | undefined;
      try {
        plaintext = await readEncryptedDraftPayload(admin, { customerId: state.customerId, jobId: state.jobId, payloadId: state.packetPayloadId,
          purpose: "MATERIAL_DRAFT_PACKET", sha256: state.packetSha256 }, { signal: child });
        ensure(!child.aborted, "ABORTED");
        ensure(createHash("sha256").update(plaintext).digest("hex") === state.packetSha256, "PACKET_DIGEST_INVALID");
        const body = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        const envelope = parse(z.object({ schemaVersion: z.literal("applypack-drafting-evidence-v1"), confirmationMode: z.literal("CUSTOMER_CONFIRMED_V1"),
          expected: draftingEvidenceExpectationSchema, validUntil: time }).passthrough(), JSON.parse(body), "PACKET_INVALID");
        ensure(JSON.stringify(envelope.expected) === JSON.stringify(parse(draftingEvidenceExpectationSchema, expected))
          && Date.parse(envelope.validUntil) > now().getTime(), "PACKET_STALE");
        // The builder has no wall-clock fields in its output. Rebuilding from the
        // exact IDs validates every field; equality forbids silently using newer
        // evidence. Freshness always uses wall time, never a backdated timestamp.
        const packet = await loadDraftingEvidencePacket(admin, expected, { signal: child, now });
        ensure(packet.packetSha256 === state.packetSha256 && serializeDraftingEvidencePacket(packet) === body
          && packet.binding.snapshotId === state.snapshotId && packet.binding.dueAt === state.dueAt, "PACKET_CHANGED");
        ensure(await context(state.jobId, child) === state.contextSha256, "CONTEXT_CHANGED");
        return packet;
      } finally { plaintext?.fill(0); }
    }),
    renewLease: (raw, signal) => {
      const claim = parse(claimSchema, raw, "INPUT_INVALID");
      return workflow.renewLease({ p_job_id: claim.jobId, p_lease_token: claim.leaseToken }, signal);
    },
    readApiKey: () => {
      ensure(enabled() && runtimePolicy !== null && approvedPolicy === runtimePolicy, "PROVIDER_DISABLED");
      const secret = process.env.OPENAI_API_KEY;
      ensure(typeof secret === "string" && secret.length >= 8 && secret.length <= 4096 && !/\s/.test(secret), "PROVIDER_CREDENTIAL_UNAVAILABLE");
      return secret;
    },
    reserve: (raw, signal) => bounded(signal, async (child) => {
      const args = parse(dispatchArgs.extend({ p_input_token_cap: z.number().int().min(1).max(50_000), p_output_token_cap: z.number().int().min(16).max(16_000) }).strict(), raw, "INPUT_INVALID");
      ensure(enabled() && approvedPolicy === args.p_policy_id && runtimePolicy === args.p_policy_id, "PROVIDER_DISABLED");
      return await data(admin.rpc("ap_begin_material_draft_request", args).abortSignal(child), child);
    }),
    recheck: (raw, signal) => bounded(signal, async (child) => {
      const args = parse(dispatchArgs, raw, "INPUT_INVALID"); ensure(enabled() && approvedPolicy === args.p_policy_id, "PROVIDER_DISABLED");
      return parse(z.literal(true), await data(admin.rpc("ap_assert_material_draft_dispatch_current", args).abortSignal(child), child));
    }),
    observe: (raw, signal) => bounded(signal, async (child) => {
      const observation = parse(z.object({ jobId: uuid, requestId: uuid, versionId: uuid, policyId: uuid,
        responseId: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/).nullable(), observedModel: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/).nullable(),
        outcome: z.enum(["PROPOSAL_VALIDATED", "PROPOSAL_REJECTED", "RESULT_UNKNOWN"]),
        usage: z.object({ inputTokens: z.number().int().min(0).max(1_000_000_000), outputTokens: z.number().int().min(0).max(1_000_000_000), totalTokens: z.number().int().min(0).max(2_000_000_000) }).strict().nullable(),
      }).strict(), raw, "OBSERVATION_INVALID");
      ensure(!observation.usage || observation.usage.inputTokens + observation.usage.outputTokens === observation.usage.totalTokens, "OBSERVATION_INVALID");
      const args: SqlObservationArgs = { p_job_id: observation.jobId, p_request_id: observation.requestId,
        p_version_id: observation.versionId, p_policy_id: observation.policyId, p_outcome: observation.outcome,
        p_provider_response_id: observation.responseId, p_response_model: observation.observedModel,
        p_input_tokens: observation.usage?.inputTokens ?? null, p_output_tokens: observation.usage?.outputTokens ?? null,
        p_total_tokens: observation.usage?.totalTokens ?? null };
      // CLI2.116's actual091 artifact omits argument nullability. SQL091:152–156
      // explicitly accepts unknown response/model and all-null usage. Preserve
      // those values; this cast changes only these five nullable RPC arguments.
      return parse(hash, await data(admin.rpc("ap_observe_material_draft_response", args as ObservationArgs).abortSignal(child), child));
    }),
    storePayload: (input, signal) => storeEncryptedDraftPayload(admin, input, { signal }),
    recordSource: (raw, signal) => bounded(signal, async (child) => {
      const args = parse(leaseArgs.extend({ p_request_id: uuid, p_source_payload_id: uuid, p_source_sha256: hash }).strict(), raw, "INPUT_INVALID");
      return parse(uuid, await data(admin.rpc("ap_record_material_draft_result", args).abortSignal(child), child));
    }),
    readRecordedSource: (jobId, requestId, signal) => bounded(signal, async (child) => {
      parse(uuid, jobId, "INPUT_INVALID"); parse(uuid, requestId, "INPUT_INVALID");
      const attempt = parse(attemptSchema, await data(admin.from("ap_material_draft_attempts").select("id,job_id,customer_id,material_line_id,draft_version_id,state")
        .eq("id", requestId).eq("job_id", jobId).abortSignal(child).single(), child));
      ensure(attempt.id === requestId && attempt.job_id === jobId, "ATTEMPT_IDENTITY_MISMATCH");
      const job = await readJob(jobId, child), version = await readVersion(attempt.draft_version_id, child); sameVersion(job, version);
      ensure(attempt.customer_id === job.customer_id && attempt.material_line_id === job.material_line_id
        && version.encrypted_payload_id && version.source_sha256, "SOURCE_IDENTITY_MISMATCH");
      const payload = parse(payloadSchema, await data(admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state")
        .eq("id", version.encrypted_payload_id).abortSignal(child).single(), child));
      ensure(payload.id === version.encrypted_payload_id && payload.customer_id === job.customer_id && payload.content_sha256 === version.source_sha256, "SOURCE_IDENTITY_MISMATCH");
      ensure(JSON.stringify(await readVersion(version.id, child)) === JSON.stringify(version)
        && JSON.stringify(await readJob(job.id, child)) === JSON.stringify(job), "SOURCE_CHANGED");
      return { jobId, customerId: job.customer_id, materialLineId: job.material_line_id, versionId: version.id, requestId,
        packetSha256: version.packet_sha256, sourceSha256: version.source_sha256, sourcePayloadId: version.encrypted_payload_id,
        attemptState: attempt.state, invalidatedAt: version.invalidated_at };
    }),
    fail: (raw, signal) => bounded(signal, async (child) => {
      const claim = parse(claimSchema, raw, "INPUT_INVALID");
      return parse(z.enum(["RESULT_UNKNOWN", "OWNER_EXCEPTION"]), await data(admin.rpc("ap_fail_material_draft_job", {
        p_job_id: claim.jobId, p_lease_token: claim.leaseToken, p_error_code: "PROVIDER_UNAVAILABLE" }).abortSignal(child), child));
    }),
  };
  return { workflow, packet: createDraftPacketServices(admin, workflow), generation };
}
