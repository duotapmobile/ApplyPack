import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { canonicalApplicationOrigin, createCapabilitySecret, hashCapabilitySecret } from "@/lib/commerce/server";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  draftId: z.uuid(),
  snapshotId: z.uuid(),
  assessmentId: z.uuid(),
  rationale: z.string().trim().min(20).max(1_000),
  expiresInMinutes: z.number().int().min(5).max(30).default(15),
}).strict();

const headers = { "cache-control": "no-store, private" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "The invitation request was rejected." }, { status: 403, headers });
  }
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A current intake, assessment, expiry, and operator rationale are required." }, { status: 400, headers });
  }
  const invitationId = randomUUID();
  const secret = createCapabilitySecret();
  const expiresAt = new Date(Date.now() + parsed.data.expiresInMinutes * 60_000).toISOString();
  const result = await access.admin.rpc("ap_issue_search_checkout_invitation", {
    p_invitation_id: invitationId,
    p_draft_id: parsed.data.draftId,
    p_snapshot_id: parsed.data.snapshotId,
    p_assessment_id: parsed.data.assessmentId,
    p_secret_hash: hashCapabilitySecret(secret),
    p_expires_at: expiresAt,
    p_issued_by: access.user.id,
    p_rationale: parsed.data.rationale,
  });
  if (result.error) {
    return NextResponse.json({ error: "The invitation could not be issued. Capacity remains unavailable." }, { status: 409, headers });
  }
  const origin = canonicalApplicationOrigin();
  const url = new URL("/get-started", origin);
  // Keep the capability out of request logs, analytics, referrers, and the
  // server-rendered URL. The customer page consumes and immediately removes it.
  url.hash = new URLSearchParams({ invitationId, invitationSecret: secret }).toString();
  return NextResponse.json({ invitationId, expiresAt, url: url.toString() }, { status: 201, headers });
}
