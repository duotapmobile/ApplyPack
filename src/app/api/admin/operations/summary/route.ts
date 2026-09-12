import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { collectOperationsSummary, containsSensitiveOperationsData } from "@/lib/operations/summary";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store, private" };

export async function GET() {
  const access = await requireAdmin();
  if (!access.ok) {
    access.response.headers.set("cache-control", "no-store, private");
    return access.response;
  }
  try {
    const summary = await collectOperationsSummary(access.admin);
    if (containsSensitiveOperationsData(summary)) {
      return NextResponse.json({ error: "Operations summary safety check failed." }, { status: 503, headers: NO_STORE_HEADERS });
    }
    const audit = await access.admin.from("audit_logs").insert({
      actor_id: access.user.id,
      action: "operations_summary_viewed",
      entity_type: "operations_summary",
      entity_id: summary.environment,
      details: { environment: summary.environment, release_sha: summary.releaseSha },
    });
    if (audit.error) {
      return NextResponse.json({ error: "Operations summary audit unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(summary, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Operations summary unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
