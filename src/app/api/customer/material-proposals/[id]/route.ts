import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const identifier = z.uuid();
const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("ACCEPT"),
    idempotencyKey: z.uuid(),
    includeReferenceSheet: z.boolean().default(false),
    referencePermissionIds: z.array(z.uuid()).max(3).default([]),
  }).strict(),
  z.object({ decision: z.literal("DECLINE"), idempotencyKey: z.uuid() }).strict(),
]);

function response(body: unknown, status = 200) {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "no-store, private");
  result.headers.set("Referrer-Policy", "no-referrer");
  return result;
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This request was rejected." }, 403);
  const proposalId = identifier.safeParse((await route.params).id);
  const input = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!proposalId.success || !input.success) return response({ error: "This proposal action is invalid." }, 400);
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return response({ error: "Materials controls are not configured." }, 503);
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return response({ error: "Authentication required." }, 401);
  const rate = await consumeRateLimit({
    request,
    scope: "chunk5_material_proposal_action",
    identity: authData.user.id,
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!rate.configured) return response({ error: "Secure proposal controls are unavailable." }, 503);
  if (!rate.allowed) return response({ error: "Too many proposal attempts. Try again later." }, 429);

  const { data: proposal } = await admin.from("ap_material_change_proposals")
    .select("id,kind,state,material_line_id,proposal_expires_at")
    .eq("id", proposalId.data).maybeSingle();
  if (!proposal) return response({ error: "Proposal not found." }, 404);
  const { data: line } = await admin.from("ap_material_lines")
    .select("id,purchase_id").eq("id", proposal.material_line_id).maybeSingle();
  const { data: purchase } = line ? await admin.from("ap_material_purchases")
    .select("customer_id").eq("id", line.purchase_id).maybeSingle() : { data: null };
  if (!line || purchase?.customer_id !== authData.user.id) return response({ error: "Proposal not found." }, 404);
  if (proposal.state !== "PROPOSED") return response({ error: "This proposal is no longer open." }, 409);
  if (new Date(proposal.proposal_expires_at).getTime() <= Date.now()) {
    return response({ error: "This proposal expired. The required line refund will be processed." }, 409);
  }

  const key = `${authData.user.id}:${proposal.id}:${input.data.decision}:${input.data.idempotencyKey}`;
  try {
    if (input.data.decision === "DECLINE") {
      const declined = await admin.rpc("ap_decline_material_change", {
        p_proposal_id: proposal.id,
        p_customer_id: authData.user.id,
        p_decline_idempotency_key: key,
      });
      if (declined.error) throw declined.error;
      return response({ decision: "DECLINED", refundRequired: true, result: declined.data });
    }
    if (proposal.kind === "SUBSTITUTION") {
      if (input.data.includeReferenceSheet !== (input.data.referencePermissionIds.length > 0)
        || new Set(input.data.referencePermissionIds).size !== input.data.referencePermissionIds.length) {
        return response({ error: "The replacement reference selection is invalid." }, 400);
      }
      const accepted = await admin.rpc("ap_accept_material_substitution", {
        p_proposal_id: proposal.id,
        p_customer_id: authData.user.id,
        p_capacity_request_key: `material-revision-capacity:${key}`,
        p_include_reference_sheet: input.data.includeReferenceSheet,
        p_reference_permission_ids: input.data.referencePermissionIds,
        p_acceptance_idempotency_key: key,
        p_outbox_id: randomUUID(),
      });
      if (accepted.error) throw accepted.error;
      return response({ decision: "ACCEPTED", result: accepted.data });
    }
    if (input.data.includeReferenceSheet || input.data.referencePermissionIds.length) {
      return response({ error: "Reference choices cannot be changed with this fact correction." }, 400);
    }
    const accepted = await admin.rpc("ap_accept_material_fact_correction", {
      p_proposal_id: proposal.id,
      p_customer_id: authData.user.id,
      p_capacity_request_key: `material-revision-capacity:${key}`,
      p_acceptance_idempotency_key: key,
      p_outbox_id: randomUUID(),
    });
    if (accepted.error) throw accepted.error;
    return response({ decision: "ACCEPTED", result: accepted.data });
  } catch {
    return response({ error: "The proposal could not be applied. Capacity, payment, listing, and deadline checks remain enforced." }, 409);
  }
}
