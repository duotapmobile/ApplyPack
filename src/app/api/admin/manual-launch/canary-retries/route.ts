import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { safeReleaseSha } from "@/lib/operations/summary";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  designationId: z.uuid(),
  evidenceReference: z.string().trim().min(12).max(500),
}).strict();

const headers = { "cache-control": "no-store, private" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "The canary retry request was rejected." }, { status: 403, headers });
  }
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") {
    return NextResponse.json({ error: "An administrator must authorize a canary retry." }, { status: 403, headers });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "The exact failed designation and retry evidence are required." }, { status: 400, headers });
  }
  const releaseSha = safeReleaseSha();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    return NextResponse.json({ error: "The exact deployed release SHA is unavailable." }, { status: 503, headers });
  }
  const result = await access.admin.rpc("ap_supersede_manual_launch_canary_designation", {
    p_designation_id: parsed.data.designationId,
    p_release_sha: releaseSha,
    p_actor_id: access.user.id,
    p_evidence_reference: parsed.data.evidenceReference,
  });
  if (result.error || result.data !== true) {
    return NextResponse.json({ error: "Only a reconciled, terminal, uncharged canary attempt can be retried." }, { status: 409, headers });
  }
  return NextResponse.json({ ok: true, designationId: parsed.data.designationId, releaseSha }, { headers });
}
