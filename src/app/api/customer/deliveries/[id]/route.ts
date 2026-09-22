import { NextResponse } from "next/server";

/** Legacy paths have no immutable revision or current evidence authorization.
 * Historical records stay intact; staff must regenerate through canonical materials. */
export async function GET() {
  return NextResponse.json({ error: "This historical delivery requires review. Use the current material delivery in your account." },
    { status: 410, headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
}
