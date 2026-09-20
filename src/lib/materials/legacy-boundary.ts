import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";

/** Historical files stay readable, but a raw upload cannot create a new release. */
export async function rejectLegacyMaterialWrite(request: Request) {
  const headers = { "Cache-Control": "no-store, private" };
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This request was rejected." }, { status: 403, headers });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    error: "This order requires the current evidence-bound materials workflow before new files can be released.",
    code: "EVIDENCE_BOUND_MATERIAL_LINE_REQUIRED",
  }, { status: 409, headers });
}
