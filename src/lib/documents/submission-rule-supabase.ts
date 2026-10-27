import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";
import { excludeEmployerInstructionSourceNodes } from "@/lib/matching/evidence-derived";
import { SubmissionRuleReviewError, type SubmissionRuleOwnerPort } from "./submission-rule-owner-server";

type Operation = "BASIS" | "SOURCE" | "PREPARE" | "CONFIRM" | "RECEIPT" | "QUEUE";
export class SubmissionRuleSqlFailure extends Error {
  readonly sqlState: string | null;
  readonly reason: string | null;
  constructor(readonly operation: Operation, error: unknown) {
    super("SUBMISSION_RULE_SQL_UNCONFIRMED");
    const value = error && typeof error === "object" ? error : {};
    this.sqlState = "code" in value && typeof value.code === "string" ? value.code : null;
    this.reason = "message" in value && typeof value.message === "string" ? value.message : null;
  }
}
function unavailable(): never { throw new SubmissionRuleReviewError("UNAVAILABLE"); }
function json(value: unknown, depth = 0): Json {
  if (depth > 32) return unavailable();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => json(item, depth + 1));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item, depth + 1)]));
  }
  return unavailable();
}
function reader(signal: AbortSignal) {
  return async <T>(operation: Operation, query: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> => {
    if (signal.aborted) return unavailable();
    const result = await query;
    if (signal.aborted) return unavailable();
    if (result.error) throw new SubmissionRuleSqlFailure(operation, result.error);
    if (result.data === undefined || result.data === null) return unavailable();
    return result.data;
  };
}
const jobColumns = "id,legacy_job_id,content_sha256,company,exact_title,canonical_application_url,source_url,captured_listing,retrieved_at,live_verified_at,discovery_source,external_job_id,source_run_id,source_authorization_id,listing_activity_result,application_path_result,legitimacy_result,application_host_type";
const nodeColumns = "id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,source_excerpt,parser_certainty,criterion_version,classification_method,importance,human_correction_history,typed_value";

/** Genuine generated104 SDK calls. Authentication and fresh MFA belong to the
 * caller; SQL also checks the trusted reviewer on each public operation. */
export function createSubmissionRulePort(admin: SupabaseClient<Database>, signal: AbortSignal): SubmissionRuleOwnerPort {
  const read = reader(signal);
  return {
    basis: (id, reviewer) => read("BASIS", admin.rpc("ap_employer_rule_review_basis", { p_job_snapshot_id: id, p_reviewer_id: reviewer }).abortSignal(signal)),
    prepare: (id, reviewer) => read("PREPARE", admin.rpc("ap_prepare_employer_rule_source_evidence", { p_job_snapshot_id: id, p_reviewer_id: reviewer }).abortSignal(signal)),
    async receipt(requestId, reviewer) {
      if (signal.aborted) return unavailable();
      const result = await admin.rpc("ap_employer_rule_review_receipt", { p_request_id: requestId, p_reviewer_id: reviewer }).abortSignal(signal);
      if (signal.aborted) return unavailable();
      if (result.error) throw new SubmissionRuleSqlFailure("RECEIPT", result.error);
      if (result.data === undefined) return unavailable();
      return result.data;
    },
    confirm: (value) => read("CONFIRM", admin.rpc("ap_confirm_employer_submission_rules", {
      p_job_snapshot_id: value.jobSnapshotId, p_reviewer_id: value.reviewerId, p_request_id: value.requestId,
      p_expected_basis: value.expectedBasis, p_confirmed_rules: json(value.confirmedRules), p_review_checklist: value.checklist, p_review_evidence: value.reviewEvidence,
    }).abortSignal(signal)),
    async source(id) {
      const record = await read("SOURCE", admin.from("ap_job_snapshots").select(jobColumns).eq("id", id).abortSignal(signal).single());
      if (record.id !== id) return unavailable();
      const rows = await read("SOURCE", admin.from("ap_requirement_nodes").select(nodeColumns).eq("job_snapshot_id", id).limit(502).abortSignal(signal));
      if (rows.length > 501 || rows.some((row) => row.job_snapshot_id !== id)) return unavailable();
      const complete = rows.map((row) => ({ ...row, node_kind: z.enum(["ALL_OF", "ANY_OF", "CRITERION"]).parse(row.node_kind) }));
      if (excludeEmployerInstructionSourceNodes(complete, record).length > 500) return unavailable();
      const { application_host_type: _host, ...job } = record;
      void _host; // Used only by the exact structural validator, never in the owner DTO.
      const capture = job.captured_listing && typeof job.captured_listing === "object" && !Array.isArray(job.captured_listing)
        && Object.hasOwn(job.captured_listing, "applicationQuestionObservation");
      const questionAuthority = capture && job.source_run_id && job.source_authorization_id ? await (async () => {
        const [run, authorization, head] = await Promise.all([
          read("SOURCE", admin.from("job_source_runs").select("id,source_id,adapter_version,source_authorization_id,authorization_head_revision,scope_sha256,status,enumeration_status")
            .eq("id", job.source_run_id!).abortSignal(signal).single()),
          read("SOURCE", admin.from("ap_source_authorizations").select("id,source_id,authorization_version,allowed_actions,state")
            .eq("id", job.source_authorization_id!).abortSignal(signal).single()),
          read("SOURCE", admin.from("ap_source_authorization_heads").select("source_id,current_authorization_id,revision")
            .eq("source_id", job.discovery_source).abortSignal(signal).single()),
        ]);
        return { run, authorization, head };
      })() : null;
      return { job, nodes: rows.map(({ id, job_snapshot_id, source_excerpt, classification_method }) => ({ id, job_snapshot_id, source_excerpt, classification_method })), questionAuthority };
    },
  };
}

const uuid = z.uuid(), timestamp = z.iso.datetime({ offset: true });
const cursorSchema = z.object({ liveVerifiedAt: timestamp, id: uuid }).strict();
export function submissionRuleQueueCursor(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("INVALID_CURSOR");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("INVALID_CURSOR");
  const cursor = cursorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  // PostgreSQL retains microseconds; a JavaScript Date round-trip would lose
  // the exact keyset boundary and skip remaining rows at that timestamp.
  if (!Number.isFinite(Date.parse(cursor.liveVerifiedAt))) throw new Error("INVALID_CURSOR");
  return cursor;
}
const summarySchema = z.object({ id: uuid, legacy_job_id: uuid, company: z.string().min(1).max(500), exact_title: z.string().min(1).max(500),
  live_verified_at: timestamp, content_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const verifiedSchema = z.object({ id: uuid, legacy_job_id: uuid, live_verified_at: timestamp, requirement_completeness: z.number() }).strict();
export type SubmissionRuleQueue = { jobs: { id: string; company: string; title: string; verifiedAt: string }[]; nextCursor: string | null; unavailable: boolean };

export async function loadSubmissionRuleQueue(admin: SupabaseClient<Database>, requestedCursor: unknown, signal: AbortSignal, now = new Date()): Promise<SubmissionRuleQueue> {
  const cursor = submissionRuleQueueCursor(requestedCursor), read = reader(signal);
  try {
    if (!Number.isFinite(now.getTime())) return unavailable();
    let query = admin.from("ap_job_snapshots").select("id,legacy_job_id,company,exact_title,live_verified_at,content_sha256")
      .not("legacy_job_id", "is", null)
      .gte("live_verified_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()).lte("live_verified_at", now.toISOString())
      .order("live_verified_at", { ascending: false }).order("id", { ascending: false }).limit(51);
    if (cursor) query = query.or(`live_verified_at.lt.${cursor.liveVerifiedAt},and(live_verified_at.eq.${cursor.liveVerifiedAt},id.lt.${cursor.id})`);
    const rows = z.array(summarySchema).max(51).parse(await read("QUEUE", query.abortSignal(signal))), consumed = rows.slice(0, 50);
    if (new Set(rows.map((row) => row.id)).size !== rows.length) return unavailable();
    if (!consumed.length) return { jobs: [], nextCursor: null, unavailable: false };
    const ids = [...new Set(consumed.map((row) => row.legacy_job_id))];
    const verified = z.array(verifiedSchema).max(50).parse(await read("QUEUE", admin.rpc("ap_current_verified_job_snapshots", { p_job_ids: ids }).abortSignal(signal)));
    if (new Set(verified.map((row) => row.id)).size !== verified.length || verified.some((row) => !ids.includes(row.legacy_job_id))) return unavailable();
    const current = new Map(verified.map((row) => [row.id, row])), last = consumed.at(-1)!;
    return { jobs: consumed.filter((row) => current.get(row.id)?.legacy_job_id === row.legacy_job_id).map((row) => ({ id: row.id, company: row.company, title: row.exact_title, verifiedAt: row.live_verified_at })),
      nextCursor: rows.length > 50 ? Buffer.from(JSON.stringify({ liveVerifiedAt: last.live_verified_at, id: last.id })).toString("base64url") : null, unavailable: false };
  } catch { return { jobs: [], nextCursor: null, unavailable: true }; }
}
