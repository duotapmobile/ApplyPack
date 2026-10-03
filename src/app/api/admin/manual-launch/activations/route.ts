import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { safeReleaseSha } from "@/lib/operations/summary";
import { isSameOriginRequest } from "@/lib/security/origin";

const reference = z.string().trim().min(12).max(500);
const schema = z.object({
  activationPhase: z.enum(["CANARY", "PUBLIC"]),
  evidence: z.object({
    healthEvidenceReference: reference,
    databaseEvidenceReference: reference,
    paymentEvidenceReference: reference,
    emailEvidenceReference: reference,
    kmsEvidenceReference: reference,
    workerEvidenceReference: reference,
    maintenanceEvidenceReference: reference,
    backupRestoreEvidenceReference: reference,
    inventoryEvidenceReference: reference,
    accessibilityEvidenceReference: reference,
    productSupervisorReference: reference,
    securitySupervisorReference: reference,
    operationsSupervisorReference: reference,
    tenthManSupervisorReference: reference,
    acceptedP2DispositionReference: reference,
    canaryReconciliationReference: reference,
    taxApprovalReference: reference,
    legacySubscriptionRetirementReference: reference,
    workerNetworkAttestationSha256: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceBundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict();

const headers = { "cache-control": "no-store, private" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "The launch activation request was rejected." }, { status: 403, headers });
  }
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") {
    return NextResponse.json({ error: "An administrator must record a launch activation." }, { status: 403, headers });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Every exact-SHA launch evidence reference is required." }, { status: 400, headers });
  }
  const releaseSha = safeReleaseSha();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    return NextResponse.json({ error: "The exact deployed release SHA is unavailable." }, { status: 503, headers });
  }
  const result = await access.admin.rpc("ap_record_manual_launch_activation", {
    p_activation_phase: parsed.data.activationPhase,
    p_release_sha: releaseSha,
    p_evidence: parsed.data.evidence,
    p_actor_id: access.user.id,
  });
  if (result.error || !result.data) {
    return NextResponse.json({
      error: parsed.data.activationPhase === "PUBLIC"
        ? "Public activation requires both completed and reconciled canary refunds plus every signed gate."
        : "The canary activation evidence is incomplete or conflicts with the deployed release.",
    }, { status: 409, headers });
  }
  return NextResponse.json({
    ok: true,
    activationId: result.data,
    activationPhase: parsed.data.activationPhase,
    releaseSha,
  }, { status: 201, headers });
}
