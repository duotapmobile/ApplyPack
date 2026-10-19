import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "The job board is not offered in the manual launch." },
    { status: 410, headers: retiredHeaders },
  );
}

const retiredHeaders = { "cache-control": "no-store, max-age=0" };
