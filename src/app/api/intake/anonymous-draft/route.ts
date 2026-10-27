import { newIntakeRecoveryHold } from "@/lib/operations/protected-recovery-readiness";
import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { fourStepDraftSchema } from "@/lib/intake/four-step";
import { fourStepPrivateState, isConfirmedIntake, publicFourStepDraft } from "@/lib/intake/four-step-server";
import { hashDraftSecret } from "@/lib/security/draft-capability";
import { isSameOriginRequest } from "@/lib/security/origin";

const updateSchema = z.object({ expectedVersion: z.number().int().positive(), currentStep: z.number().int().min(0).max(3), answers: fourStepDraftSchema }).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This draft request was rejected." }, { status: 403 });
  return NextResponse.json({ error: "Verify your email and choose Start my intake from Get Started.", code: "VERIFIED_INTAKE_REQUIRED" },
    { status: 409, headers: { "cache-control": "private, no-store" } });
}

export async function GET() {
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ draft: null }, { headers: { "cache-control": "no-store" } });
  const { data, error } = await context.admin.rpc("ap_read_four_step_draft", { p_draft_id: context.capability.draftId, p_secret_hash: context.secretHash });
  if (error) { const mapped = anonymousDraftError(error); return NextResponse.json(mapped.body, { status: mapped.status }); }
  const row = Array.isArray(data) ? data[0] : null;
  const state = row ? await fourStepPrivateState(context.admin, context.capability.draftId).catch(() => null) : null;
  if (row && !state) return NextResponse.json({ error: "The saved intake details are temporarily unavailable." }, { status: 502 });
  const publicDraft = row ? publicFourStepDraft(row as Record<string, unknown>, state!) : null;
  const confirmedIntake = publicDraft ? await isConfirmedIntake(context.admin, context.capability.draftId,
    publicDraft.finalizedSnapshotId as string | null).catch(() => null) : false;
  if (confirmedIntake === null) return NextResponse.json({ error: "The saved intake confirmation is temporarily unavailable." }, { status: 502, headers: { "cache-control": "no-store" } });
  let legalContentAccepted = false;
  if (publicDraft?.finalizedSnapshotId) {
    const legal = await context.admin.rpc("ap_has_current_content_bound_legal_acceptance", {
      p_draft_id: context.capability.draftId,
      p_snapshot_id: publicDraft.finalizedSnapshotId,
    });
    if (legal.error) return NextResponse.json({ error: "The saved intake legal status is temporarily unavailable." }, { status: 502 });
    legalContentAccepted = legal.data === true;
  }
  return NextResponse.json({ draft: publicDraft ? { ...publicDraft, legalContentAccepted, confirmedIntake } : null }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This draft request was rejected." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 64 * 1024) return NextResponse.json({ error: "The intake draft is too large." }, { status: 413 });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404 });
  const recoveryHold = await newIntakeRecoveryHold(context.admin);
  if (recoveryHold) return recoveryHold;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || JSON.stringify(parsed.data.answers).length > 60_000) return NextResponse.json({ error: "The intake draft is invalid or too large." }, { status: 400 });
  const { data, error } = await context.admin.rpc("ap_save_four_step_draft", { p_draft_id: context.capability.draftId, p_secret_hash: hashDraftSecret(context.capability.secret), p_expected_version: parsed.data.expectedVersion, p_current_step: parsed.data.currentStep, p_answers: parsed.data.answers });
  if (error || !Array.isArray(data) || !data[0]) { const mapped = anonymousDraftError(error); return NextResponse.json(mapped.body, { status: mapped.status, headers: { "cache-control": "no-store" } }); }
  const state = await fourStepPrivateState(context.admin, context.capability.draftId);
  return NextResponse.json({ draft: publicFourStepDraft(data[0] as Record<string, unknown>, state) }, { headers: { "cache-control": "no-store" } });
}
