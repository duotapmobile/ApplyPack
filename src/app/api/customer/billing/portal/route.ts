import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "Subscription billing management is not offered in the manual launch." },
    { status: 410, headers: retiredHeaders },
  );
}

const retiredHeaders = { "cache-control": "no-store, max-age=0" };
