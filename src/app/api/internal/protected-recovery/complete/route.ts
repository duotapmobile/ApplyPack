import { boundedRecoveryJson, protectedRecoveryContext, protectedRecoveryError, recoveryHeaders } from "@/lib/operations/protected-recovery-source";
import { persistRecoveryCompletion, validateRecoveryCompletion } from "../../../../../../scripts/lib/protected-recovery-source.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { admin, configuration } = protectedRecoveryContext(request, "complete");
    if (new URL(request.url).search !== "") throw new Error("PROTECTED_RECOVERY_QUERY_FORBIDDEN");
    const summary = validateRecoveryCompletion(await boundedRecoveryJson(request), configuration);
    await persistRecoveryCompletion(admin, summary);
    return Response.json({ ok: true, sourceStartedAt: summary.sourceStartedAt, manifestSha256: summary.manifestSha256 }, { headers: recoveryHeaders });
  } catch (error) { return protectedRecoveryError(error); }
}
