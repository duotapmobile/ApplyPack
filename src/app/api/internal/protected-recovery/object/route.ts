import { protectedRecoveryContext, protectedRecoveryError, recoveryHeaders } from "@/lib/operations/protected-recovery-source";
import { createSupabaseRecoveryReader, readRecoveryObject } from "../../../../../../scripts/lib/protected-recovery-source.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { admin } = protectedRecoveryContext(request, "read");
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].sort().join("|") !== "bucket|key|sourceVersion") throw new Error("PROTECTED_RECOVERY_QUERY_INVALID");
    const object = await readRecoveryObject({ reader: createSupabaseRecoveryReader(admin), bucket: query.get("bucket"),
      key: query.get("key"), sourceVersion: query.get("sourceVersion") });
    return new Response(new Uint8Array(object.bytes), { headers: { ...recoveryHeaders, "content-type": "application/octet-stream",
      "content-length": String(object.size), "x-recovery-source-version": object.sourceVersion, "x-recovery-sha256": object.sha256 } });
  } catch (error) { return protectedRecoveryError(error); }
}
