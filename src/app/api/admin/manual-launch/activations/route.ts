import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { safeReleaseSha } from "@/lib/operations/summary";
import { SANDBOX_ACTIVATION_CONTRACT_VERSION, sandboxValidationMatchesRelease, sandboxValidationSchema } from "@/lib/operations/sandbox-validation";
import { isSameOriginRequest } from "@/lib/security/origin";
import { checkoutConfiguration } from "@/lib/stripe/mode";

const reference = z.string().trim().min(12).max(500);
const schema = z.object({
  activationPhase: z.enum(["CANARY", "PUBLIC"]),
  activationContractVersion: z.literal(SANDBOX_ACTIVATION_CONTRACT_VERSION).optional(),
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
    canaryReconciliationReference: reference.optional(),
    sandboxValidation: sandboxValidationSchema.optional(),
    legacySubscriptionRetirementReference: reference,
    workerNetworkAttestationSha256: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceBundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.activationPhase === "PUBLIC") {
    if (value.activationContractVersion !== SANDBOX_ACTIVATION_CONTRACT_VERSION
      || !value.evidence.sandboxValidation || value.evidence.canaryReconciliationReference) {
      context.addIssue({ code: "custom", message: "Public activation requires the current sandbox receipt contract." });
    }
  } else if (!value.evidence.canaryReconciliationReference
    || value.evidence.sandboxValidation || value.activationContractVersion) {
    context.addIssue({ code: "custom", message: "Staging canary activation requires its separate reconciliation reference." });
  }
});

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
    return NextResponse.json({ error: "Every exact-SHA launch evidence reference and the current activation contract are required." }, { status: 400, headers });
  }
  const checkout = checkoutConfiguration();
  const allowedState = parsed.data.activationPhase === "PUBLIC"
    ? ["LOCKED_PRODUCTION", "PUBLIC_INVITATION"].includes(checkout.state)
    : ["LOCKED_STAGING", "STAGING_CANARY"].includes(checkout.state);
  if (!allowedState) {
    return NextResponse.json({ error: "Public activation requires production; canary activation is restricted to the configured sandbox." }, { status: 409, headers });
  }
  const releaseSha = safeReleaseSha();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    return NextResponse.json({ error: "The exact deployed release SHA is unavailable." }, { status: 503, headers });
  }
  if (parsed.data.activationPhase === "PUBLIC"
    && !sandboxValidationMatchesRelease(parsed.data.evidence.sandboxValidation, releaseSha)) {
    return NextResponse.json({ error: "Sandbox proof must match this release and have been verified within the previous 24 hours." }, { status: 409, headers });
  }
  const result = await access.admin.rpc("ap_record_manual_launch_activation", {
    p_activation_phase: parsed.data.activationPhase,
    p_release_sha: releaseSha,
    p_evidence: {
      ...parsed.data.evidence,
      ...(parsed.data.activationContractVersion ? { activationContractVersion: parsed.data.activationContractVersion } : {}),
    },
    p_actor_id: access.user.id,
  });
  if (result.error || !result.data) {
    return NextResponse.json({
      error: parsed.data.activationPhase === "PUBLIC"
        ? "Public activation requires the verified sandbox receipt and every reviewed launch gate."
        : "The canary activation evidence is incomplete or conflicts with the deployed release.",
    }, { status: 409, headers });
  }
  return NextResponse.json({
    ok: true,
    activationId: result.data,
    activationPhase: parsed.data.activationPhase,
    ...(parsed.data.activationContractVersion ? { activationContractVersion: parsed.data.activationContractVersion } : {}),
    releaseSha,
  }, { status: 201, headers });
}
