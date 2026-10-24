import { boundedRecoveryJson, protectedRecoveryContext, protectedRecoveryError, recoveryHeaders } from "@/lib/operations/protected-recovery-source";
import { persistRecoveryCompletion, validateRecoveryRetentionCompletion } from "../../../../../../scripts/lib/protected-recovery-source.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { admin, configuration } = protectedRecoveryContext(request, "retention");
    if (new URL(request.url).search !== "") throw new Error("PROTECTED_RECOVERY_QUERY_FORBIDDEN");
    const summary = validateRecoveryRetentionCompletion(await boundedRecoveryJson(request), configuration);
    await persistRecoveryCompletion(admin, summary, "protected_recovery_retention");
    return Response.json({ ok: true, sourceStartedAt: summary.sourceStartedAt, planSha256: summary.planSha256 }, { headers: recoveryHeaders });
  } catch (error) { return protectedRecoveryError(error); }
}
