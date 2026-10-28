import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { projectSourceRun } from "@/lib/jobs/source-projection";
import { processResearchPreparation, type PreparationPort, type PreparationClaim } from "./research-preparation";

type Admin = SupabaseClient<Database>;
const sourceSchema = z.object({ id: z.uuid(), schedule_id: z.uuid(), source_authorization_id: z.uuid(),
  authorization_head_revision: z.number().int().positive(), source_run_id: z.uuid().nullable() }).passthrough();
function ensure(value: unknown): asserts value { if (!value) throw new Error("research_preparation_unconfirmed"); }

export function createResearchPreparationPort(admin: Admin): PreparationPort {
  async function data(signal: AbortSignal, query: () => PromiseLike<{ data: unknown; error: unknown }>) {
    signal.throwIfAborted(); const result = await query();
    signal.throwIfAborted(); ensure(!result.error); return result.data;
  }
  return {
    claim: signal => data(signal, () => admin.rpc("ap_claim_research_preparation").abortSignal(signal)),
    async load(claim, signal) {
      const [snapshot, facts] = await Promise.all([
        admin.from("ap_intake_snapshots").select("*").eq("id", claim.snapshot_id).abortSignal(signal).maybeSingle(),
        admin.from("ap_candidate_facts").select("*").eq("snapshot_id", claim.snapshot_id).is("superseded_at", null).limit(1001).abortSignal(signal),
      ]);
      ensure(!snapshot.error && snapshot.data && !facts.error && facts.data && facts.data.length <= 1000);
      return { snapshot: snapshot.data, facts: facts.data };
    },
    async prepare(claim, families, signal) {
      z.uuid().parse(await data(signal, () => admin.rpc("ap_prepare_automatic_research", {
        p_preparation_id: claim.id, p_lease_token: claim.lease_token, p_families: families,
      }).abortSignal(signal)));
    },
    async collect(claim, signal) {
      const rows = await admin.from("ap_research_preparation_sources").select("id,schedule_id,source_authorization_id,authorization_head_revision,source_run_id")
        .eq("preparation_id", claim.id).order("id").limit(6).abortSignal(signal);
      ensure(!rows.error); const sources = z.array(sourceSchema).min(1).max(5).parse(rows.data);
      for (const source of sources) {
        signal.throwIfAborted();
        if (source.source_run_id) continue;
        // Existing periodic collection owns all actual HTTP traffic and quotas.
        // Reusing a complete current capture avoids a per-customer network scan.
        const result = await admin.from("job_source_runs").select("id")
          .eq("schedule_id", source.schedule_id).eq("source_authorization_id", source.source_authorization_id)
          .eq("authorization_head_revision", source.authorization_head_revision).eq("status", "succeeded")
          .eq("enumeration_status", "complete").is("checkpoint_start", null)
          .gte("completed_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
          .order("completed_at", { ascending: false }).limit(1).abortSignal(signal).maybeSingle();
        ensure(!result.error);
        if (!result.data) continue;
        const runId = z.uuid().parse(result.data.id);
        // Projection remains inactive/unverified. Only the owner can promote it.
        await projectSourceRun(admin, runId, { signal, maximumResults: 100 });
        signal.throwIfAborted();
        const bound = z.uuid().parse(await data(signal, () => admin.rpc("ap_bind_prepared_research_run", {
          p_preparation_id: claim.id, p_lease_token: claim.lease_token, p_source_id: source.id, p_run_id: runId,
        }).abortSignal(signal)));
        ensure(bound === runId);
      }
      z.enum(["COLLECTING", "OWNER_REVIEW", "READY", "COMPLETE"]).parse(await data(signal, () => admin.rpc("ap_finish_research_preparation_check", {
        p_preparation_id: claim.id, p_lease_token: claim.lease_token,
      }).abortSignal(signal)));
    },
  };
}

export async function processAutomaticResearchPreparation(options: {
  signal?: AbortSignal; clientFactory?: (signal: AbortSignal) => Admin | null;
} = {}) {
  const enabled = process.env.APP_AUTOMATIC_RESEARCH_ENABLED === "true";
  // Disabled means no client creation, credentials, reads, claims or providers.
  if (!enabled) return { status: "DISABLED" as const, processed: 0 };
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(options.signal ? [options.signal] : [])]);
  const admin = (options.clientFactory ?? (signal => createSupabaseAdminClient({ signal })))(signal);
  ensure(admin);
  return processResearchPreparation(createResearchPreparationPort(admin), { enabled, signal });
}

export async function preparationAllowsFeasibility(admin: Admin, requestId: string) {
  const result = await admin.rpc("ap_research_preparation_ready", { p_request_id: z.uuid().parse(requestId) });
  ensure(!result.error); return z.boolean().parse(result.data);
}

export type ResearchPreparationIdentity = Pick<PreparationClaim, "id" | "snapshot_id" | "request_id">;
