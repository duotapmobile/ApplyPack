import { NextResponse } from "next/server";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { isSameOriginRequest } from "@/lib/security/origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This edit request was rejected." }, {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  const context = await anonymousDraftContext();
  if (!context) {
    return NextResponse.json({ error: "The saved intake is unavailable." }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  const { data, error } = await context.admin.rpc("ap_begin_pre_activation_edit", {
    p_draft_id: context.capability.draftId,
    p_secret_hash: context.secretHash,
  });
  if (error || typeof data !== "number") {
    const mapped = anonymousDraftError(error);
    return NextResponse.json(mapped.body, {
      status: mapped.status,
      headers: { "cache-control": "no-store" },
    });
  }
  return NextResponse.json({ draftVersion: data }, {
    headers: { "cache-control": "no-store" },
  });
}
