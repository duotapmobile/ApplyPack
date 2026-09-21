import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processJobSourceWorkers } from "@/lib/jobs/source-worker";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || !provided) return false;
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  try {
    const jobSources = await processJobSourceWorkers(admin);
    return NextResponse.json({ ok: true, jobSources });
  } catch {
    return NextResponse.json({ error: "Job-source worker failed." }, { status: 500 });
  }
}
