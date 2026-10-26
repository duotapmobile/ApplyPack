import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deterministicUuid, parsePostgresBytea, postgresBytea } from "@/lib/commerce/server";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { decryptSensitivePayload, encryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady,
  type KmsEnvelopeAdapter, type SensitivePayloadConfiguration } from "@/lib/security/sensitive-payload";
import { loadDraftingEvidencePacket } from "./drafting-evidence-server";
import { DraftingEvidenceError, serializeDraftingEvidencePacket, type DraftingEvidenceExpectation, type DraftingEvidencePacket } from "./drafting-evidence";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const claimSchema = z.object({ jobId: uuid, ownerId: uuid, leaseToken: uuid }).strict();
const jobSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid, source_snapshot_id: uuid,
  state: z.enum(["PREPARING", "READY", "SOURCE_READY", "RENDERING"]), active_version_id: uuid.nullable(),
  lease_owner: uuid, lease_token: uuid, lease_generation: z.number().int().positive(), lease_expires_at: time });
const revisionSchema = z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, version: z.number().int().positive(), binding_sha256: hash,
  due_at: time, superseded_at: z.null() }).strict();
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, packet_encrypted_payload_id: uuid,
  packet_sha256: hash, context_sha256: hash, invalidated_at: z.null() });
const payloadSchema = z.object({ id: uuid, customer_id: uuid, content_sha256: hash, retention_state: z.literal("ACTIVE"), encryption_context_hash: hash });
export class DraftPacketWorkerError extends Error {
  constructor(readonly code: string) { super(`DRAFT_PACKET_${code}`); this.name = "DraftPacketWorkerError"; }
}
function assert(value: unknown, code: string): asserts value { if (!value) throw new DraftPacketWorkerError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value); assert(result.success, code); return result.data;
}

/** Exact 091 surface. The caller wires this to a service-only generated client;
 * unknown results are validated here, never treated as successful RPC receipts. */
export type DraftPacketWorkflowPort = {
  readJob(jobId: string, signal: AbortSignal): Promise<unknown>;
  readVersion(versionId: string, signal: AbortSignal): Promise<unknown>;
  renewLease(args: { p_job_id: string; p_lease_token: string }, signal: AbortSignal): Promise<unknown>;
  readContext(args: { p_job_id: string }, signal: AbortSignal): Promise<unknown>;
  attach(args: { p_job_id: string; p_lease_token: string; p_payload_id: string; p_packet_sha256: string; p_context_sha256: string }, signal: AbortSignal): Promise<unknown>;
};
export const draftPayloadPurposes = ["MATERIAL_DRAFT_PACKET", "MATERIAL_DRAFT_SOURCE", "MATERIAL_DRAFT_CLAIM_REVIEW", "MATERIAL_DRAFT_CHANGE_REQUEST"] as const;
const payloadInputSchema = z.object({ customerId: uuid, jobId: uuid, payloadId: uuid, purpose: z.enum(draftPayloadPurposes),
  body: z.string().min(1).max(4_000_000), sha256: hash }).strict();
export type DraftPayloadInput = z.infer<typeof payloadInputSchema>;
const payloadReadSchema = payloadInputSchema.omit({ body: true });
export type DraftPayloadReadInput = z.infer<typeof payloadReadSchema>;
export function draftPayloadEncryptionContext(input: Pick<DraftPayloadInput, "customerId" | "jobId" | "payloadId" | "purpose">) {
  return { customerId: input.customerId, jobId: input.jobId, payloadId: input.payloadId, purpose: input.purpose };
}
type CryptoOptions = { configuration?: SensitivePayloadConfiguration; kms?: KmsEnvelopeAdapter; signal?: AbortSignal };
type Admin = SupabaseClient<Database>;

async function boundedPayloadIo<T>(external: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  assert(!external?.aborted, "ABORTED");
  const controller = new AbortController(), abort = () => controller.abort();
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) controller.abort();
  const timer = setTimeout(abort, 20_000);
  const interrupted = new Promise<never>((_, reject) => {
    const stop = () => reject(new DraftPacketWorkerError("ABORTED"));
    if (controller.signal.aborted) stop(); else controller.signal.addEventListener("abort", stop, { once: true });
  });
  try { return await Promise.race([operation(controller.signal), interrupted]); }
  finally { clearTimeout(timer); external?.removeEventListener("abort", abort); }
}

/** The service caller derives all IDs/purpose/hash from an authorized immutable
 * job/version, never a customer-supplied payload ID. This returns verified bytes,
 * not trusted JSON. The caller owns the Buffer and must fill(0) after consumption. */
export async function readEncryptedDraftPayload(admin: Admin, raw: DraftPayloadReadInput, options: CryptoOptions = {}): Promise<Buffer> {
  const input = parse(payloadReadSchema, raw, "PAYLOAD_INPUT_INVALID");
  return boundedPayloadIo(options.signal, async (signal) => {
    let plaintext: Buffer | undefined, transferred = false;
    try {
      assert(!signal.aborted, "ABORTED");
      const configuration = options.configuration ?? sensitivePayloadConfiguration();
      assert(sensitivePayloadEncryptionReady(configuration), "ENCRYPTION_UNAVAILABLE");
      const result = await admin.from("ap_sensitive_payloads")
        .select("id,customer_id,content_sha256,retention_state,encryption_context_hash,encryption_algorithm,ciphertext,encrypted_data_key,nonce,authentication_tag,kms_key_identity,kms_key_version")
        .eq("id", input.payloadId).abortSignal(signal).single();
      assert(!signal.aborted, "ABORTED");
      const bytea = (max: number) => z.string().regex(/^\\x(?:[a-fA-F0-9]{2})+$/).max(2 + max * 2);
      const row = parse(payloadSchema.extend({ encryption_algorithm: z.literal("AES-256-GCM"), ciphertext: bytea(4_000_000),
        encrypted_data_key: bytea(16_384), nonce: bytea(12), authentication_tag: bytea(16),
        kms_key_identity: z.string().min(1).max(2048), kms_key_version: z.string().min(1).max(100) }), result.data, "PAYLOAD_UNAVAILABLE");
      assert(!result.error && row.id === input.payloadId && row.customer_id === input.customerId && row.content_sha256 === input.sha256, "PAYLOAD_IDENTITY_MISMATCH");
      plaintext = await decryptSensitivePayload({ configuration, kms: options.kms ?? remoteKmsAdapter(), context: draftPayloadEncryptionContext(input),
        envelope: { algorithm: row.encryption_algorithm, ciphertext: parsePostgresBytea(row.ciphertext), encryptedDataKey: parsePostgresBytea(row.encrypted_data_key),
          nonce: parsePostgresBytea(row.nonce), authenticationTag: parsePostgresBytea(row.authentication_tag), contentSha256: row.content_sha256,
          keyIdentity: row.kms_key_identity, keyVersion: row.kms_key_version, encryptionContextHash: row.encryption_context_hash } });
      assert(!signal.aborted, "ABORTED");
      assert(plaintext.length > 0 && plaintext.length <= 4_000_000 && createHash("sha256").update(plaintext).digest("hex") === input.sha256, "PAYLOAD_DIGEST_INVALID");
      const current = await admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state,encryption_context_hash")
        .eq("id", input.payloadId).abortSignal(signal).single();
      const receipt = parse(payloadSchema, current.data, "PAYLOAD_UNAVAILABLE");
      assert(!signal.aborted, "ABORTED");
      assert(!current.error && receipt.id === row.id && receipt.customer_id === row.customer_id && receipt.content_sha256 === row.content_sha256
        && receipt.encryption_context_hash === row.encryption_context_hash, "PAYLOAD_IDENTITY_MISMATCH");
      transferred = true; return plaintext;
    } catch (error) {
      if (error instanceof DraftPacketWorkerError) throw error;
      throw new DraftPacketWorkerError("PAYLOAD_UNAVAILABLE");
    } finally { if (!transferred) plaintext?.fill(0); }
  });
}

/** Stores exact UTF-8 bytes using the existing envelope service. A lost insert
 * response is reconciled by immutable identity; no payload is ever deleted here. */
export async function storeEncryptedDraftPayload(admin: Admin, raw: DraftPayloadInput, options: CryptoOptions = {}) {
  return boundedPayloadIo(options.signal, async (signal) => {
  const input = parse(payloadInputSchema, raw, "PAYLOAD_INPUT_INVALID"), plaintext = Buffer.from(input.body, "utf8");
  try {
    assert(!signal.aborted, "ABORTED");
    assert(plaintext.length <= 4_000_000 && createHash("sha256").update(plaintext).digest("hex") === input.sha256, "PAYLOAD_DIGEST_INVALID");
    const configuration = options.configuration ?? sensitivePayloadConfiguration();
    assert(sensitivePayloadEncryptionReady(configuration), "ENCRYPTION_UNAVAILABLE");
    const envelope = await encryptSensitivePayload({ plaintext, context: draftPayloadEncryptionContext(input), configuration, kms: options.kms ?? remoteKmsAdapter() });
    assert(!signal.aborted, "ABORTED");
    assert(envelope.contentSha256 === input.sha256, "ENCRYPTION_DIGEST_INVALID");
    let inserted = false;
    try {
      const query = admin.from("ap_sensitive_payloads").insert({ id: input.payloadId, customer_id: input.customerId,
        ciphertext: postgresBytea(envelope.ciphertext), encryption_algorithm: envelope.algorithm, encrypted_data_key: postgresBytea(envelope.encryptedDataKey),
        nonce: postgresBytea(envelope.nonce), authentication_tag: postgresBytea(envelope.authenticationTag), content_sha256: envelope.contentSha256,
        kms_key_identity: envelope.keyIdentity, kms_key_version: envelope.keyVersion, encryption_context_hash: envelope.encryptionContextHash });
      const result = await query.abortSignal(signal); inserted = !result.error;
    } catch { /* The insert may have committed. Verify its immutable receipt. */ }
    assert(!signal.aborted, "PERSIST_RESULT_UNKNOWN");
    const query = admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state,encryption_context_hash").eq("id", input.payloadId);
    const result = await query.abortSignal(signal).single();
    assert(!signal.aborted, "PERSIST_RESULT_UNKNOWN");
    const payload = parse(payloadSchema, result.data, "PERSIST_RESULT_UNKNOWN");
    assert(!result.error && payload.id === input.payloadId && payload.customer_id === input.customerId && payload.content_sha256 === input.sha256
      && payload.encryption_context_hash === envelope.encryptionContextHash, "PERSIST_IDENTITY_MISMATCH");
    return { payloadId: payload.id, sha256: payload.content_sha256, reconciled: !inserted };
  } catch (error) {
    if (error instanceof DraftPacketWorkerError) throw error;
    throw new DraftPacketWorkerError("PERSIST_RESULT_UNKNOWN");
  } finally { plaintext.fill(0); }
  });
}

export type DraftPacketServices = {
  workflow: DraftPacketWorkflowPort;
  readRevision(id: string, signal: AbortSignal): Promise<unknown>;
  readPayload(id: string, signal: AbortSignal): Promise<unknown>;
  loadPacket(expected: DraftingEvidenceExpectation, options: { signal: AbortSignal; now: () => Date }): Promise<DraftingEvidencePacket>;
  storePayload(input: DraftPayloadInput, signal: AbortSignal): Promise<{ payloadId: string; sha256: string }>;
};
export function createDraftPacketServices(admin: Admin, workflow: DraftPacketWorkflowPort): DraftPacketServices {
  return { workflow,
    readRevision: async (id, signal) => {
      const result = await admin.from("ap_material_line_revisions").select("id,line_id,source_snapshot_id,version,binding_sha256,due_at,superseded_at").eq("id", id).abortSignal(signal).single();
      assert(!result.error, "REVISION_UNAVAILABLE"); return result.data;
    },
    readPayload: async (id, signal) => {
      const result = await admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state,encryption_context_hash").eq("id", id).abortSignal(signal).single();
      assert(!result.error, "PAYLOAD_UNAVAILABLE"); return result.data;
    },
    loadPacket: (expected, options) => loadDraftingEvidencePacket(admin, expected, options),
    storePayload: (input, signal) => storeEncryptedDraftPayload(admin, input, { signal }),
  };
}

/** No provider dispatch, approval, rendering, delivery or deletion occurs here. */
export async function attachDraftPacketForClaim(services: DraftPacketServices, raw: z.infer<typeof claimSchema>, options: { now?: () => Date; signal?: AbortSignal } = {}) {
  const input = parse(claimSchema, raw, "CLAIM_INVALID"), now = options.now ?? (() => new Date()), controller = new AbortController();
  const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 60_000), signal = controller.signal;
  const check = () => { assert(!signal.aborted, "ABORTED"); assert(Number.isFinite(now().getTime()), "CLOCK_INVALID"); };
  async function call<T>(operation: () => Promise<T>) {
    check(); let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { stop = () => reject(new DraftPacketWorkerError("ABORTED")); signal.addEventListener("abort", stop, { once: true }); });
    try { const value = await Promise.race([operation(), interrupted]); check(); return value; }
    finally { signal.removeEventListener("abort", stop); }
  }
  const readJob = async () => {
    const job = parse(jobSchema, await call(() => services.workflow.readJob(input.jobId, signal)), "CLAIM_STALE");
    assert(job.id === input.jobId && job.lease_owner === input.ownerId && job.lease_token === input.leaseToken && Date.parse(job.lease_expires_at) > now().getTime(), "CLAIM_STALE"); return job;
  };
  try {
    const job = await readJob();
    const renewed = parse(time, await call(() => services.workflow.renewLease({ p_job_id: job.id, p_lease_token: input.leaseToken }, signal)), "CLAIM_STALE");
    assert(Date.parse(renewed) > now().getTime(), "CLAIM_STALE");
    const revision = parse(revisionSchema, await call(() => services.readRevision(job.line_revision_id, signal)), "REVISION_INVALID");
    assert(revision.id === job.line_revision_id && revision.line_id === job.material_line_id && revision.source_snapshot_id === job.source_snapshot_id && Date.parse(revision.due_at) > now().getTime(), "REVISION_INVALID");
    const context = parse(hash, await call(() => services.workflow.readContext({ p_job_id: job.id }, signal)), "CONTEXT_INVALID");
    const reconcile = async (expected?: { payloadId: string; packetSha256: string }, ambiguous = false) => {
      const current = await readJob();
      assert(current.customer_id === job.customer_id && current.material_line_id === job.material_line_id && current.line_revision_id === job.line_revision_id
        && current.source_snapshot_id === job.source_snapshot_id && current.lease_generation === job.lease_generation && current.active_version_id, ambiguous ? "ATTACH_RESULT_UNKNOWN" : "CLAIM_STALE");
      const version = parse(versionSchema, await call(() => services.workflow.readVersion(current.active_version_id!, signal)), "ATTACH_RESULT_UNKNOWN");
      assert(version.id === current.active_version_id && version.job_id === job.id && version.customer_id === job.customer_id && version.material_line_id === job.material_line_id
        && version.context_sha256 === context && (!expected || version.packet_encrypted_payload_id === expected.payloadId && version.packet_sha256 === expected.packetSha256), "ATTACH_IDENTITY_MISMATCH");
      const payload = parse(payloadSchema, await call(() => services.readPayload(version.packet_encrypted_payload_id, signal)), "PAYLOAD_UNAVAILABLE");
      assert(payload.id === version.packet_encrypted_payload_id && payload.customer_id === job.customer_id && payload.content_sha256 === version.packet_sha256, "PAYLOAD_IDENTITY_MISMATCH");
      assert(await call(() => services.workflow.readContext({ p_job_id: job.id }, signal)) === context, "CONTEXT_CHANGED");
      return { jobId: job.id, versionId: version.id, payloadId: payload.id, packetSha256: version.packet_sha256, contextSha256: context,
        status: ambiguous ? "ATTACHED_AFTER_AMBIGUOUS_RESPONSE" as const : expected ? "ATTACHED" as const : "ALREADY_ATTACHED" as const };
    };
    if (job.active_version_id) return await reconcile();
    assert(job.state === "PREPARING", "CLAIM_STALE");
    const expected = { customerId: job.customer_id, materialLineId: job.material_line_id, revisionId: revision.id, revisionVersion: revision.version, bindingSha256: revision.binding_sha256 };
    const packet = await call(() => services.loadPacket(expected, { signal, now }));
    assert(Object.keys(expected).every((key) => packet.expected[key as keyof typeof expected] === expected[key as keyof typeof expected])
      && packet.binding.snapshotId === job.source_snapshot_id && packet.binding.dueAt === revision.due_at && Date.parse(packet.validUntil) > now().getTime(), "PACKET_BINDING_INVALID");
    const body = serializeDraftingEvidencePacket(packet);
    assert(await call(() => services.workflow.readContext({ p_job_id: job.id }, signal)) === context, "CONTEXT_CHANGED");
    const payloadId = deterministicUuid(`applypack:draft-packet:${job.id}:${context}:${packet.packetSha256}`);
    const stored = await call(() => services.storePayload({ customerId: job.customer_id, jobId: job.id, payloadId, purpose: "MATERIAL_DRAFT_PACKET", body, sha256: packet.packetSha256 }, signal));
    assert(stored.payloadId === payloadId && stored.sha256 === packet.packetSha256, "PERSIST_IDENTITY_MISMATCH");
    check(); assert(Date.parse(packet.validUntil) > now().getTime() && Date.parse(revision.due_at) > now().getTime(), "PACKET_EXPIRED");
    let receipt: string | null = null;
    try { receipt = parse(uuid, await call(() => services.workflow.attach({ p_job_id: job.id, p_lease_token: input.leaseToken,
      p_payload_id: payloadId, p_packet_sha256: packet.packetSha256, p_context_sha256: context }, signal)), "ATTACH_RESULT_UNKNOWN"); }
    catch { /* Resolve a lost response by exact stored identities, never deletion. */ }
    const result = await reconcile({ payloadId, packetSha256: packet.packetSha256 }, receipt === null);
    assert(receipt === null || result.versionId === receipt, "ATTACH_IDENTITY_MISMATCH"); return result;
  } catch (error) {
    if (error instanceof DraftPacketWorkerError) throw error;
    if (error instanceof DraftingEvidenceError && error.message === "DRAFTING_EVIDENCE_LEGACY_INTAKE_UNSUPPORTED") throw new DraftPacketWorkerError("LEGACY_INTAKE_OWNER_EXCEPTION");
    throw new DraftPacketWorkerError("SOURCE_UNAVAILABLE");
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
