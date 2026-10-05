import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "Subscription checkout is not offered in the manual launch." },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
