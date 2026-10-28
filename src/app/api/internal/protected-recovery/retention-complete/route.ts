import { protectedRecoveryContext, protectedRecoveryError, recoveryHeaders } from "@/lib/operations/protected-recovery-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    protectedRecoveryContext(request, "retention");
    if (new URL(request.url).search !== "") throw new Error("PROTECTED_RECOVERY_QUERY_FORBIDDEN");
    // A worker-supplied digest is not independently verified absence. Historical
    // receipts remain readable; new success is atomic with lifecycle COMPLETE.
    return Response.json({ error: "Use the verified archive lifecycle completion." }, { status: 409, headers: recoveryHeaders });
  } catch (error) { return protectedRecoveryError(error); }
}
