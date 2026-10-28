import { protectedRecoveryContext, protectedRecoveryError, recoveryHeaders } from "@/lib/operations/protected-recovery-source";
import { buildRecoveryInventory, createSupabaseRecoveryReader, signRecoveryReceipt } from "../../../../../../scripts/lib/protected-recovery-source.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { admin, configuration } = protectedRecoveryContext(request, "inventory");
    if (new URL(request.url).search !== "") throw new Error("PROTECTED_RECOVERY_QUERY_FORBIDDEN");
    const inventory = await buildRecoveryInventory({ reader: createSupabaseRecoveryReader(admin), releaseSha: configuration.releaseSha,
      signReceipt: (value: Parameters<typeof signRecoveryReceipt>[0]) => signRecoveryReceipt(value, configuration.receiptSecret) });
    return Response.json(inventory, { headers: recoveryHeaders });
  } catch (error) { return protectedRecoveryError(error); }
}
