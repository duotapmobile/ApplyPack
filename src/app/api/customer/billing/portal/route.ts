import { NextResponse } from "next/server";
import { canonicalApplicationOrigin } from "@/lib/commerce/server";
import { requireLegacyBoardArchiveAccess } from "@/lib/job-board/access";
import { createStripeOperationalClient } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function POST() {
  const access = await requireLegacyBoardArchiveAccess();
  if (!access.ok) return retired();
  const stripe = createStripeOperationalClient();
  if (!stripe) return NextResponse.json({ error: "Billing management is unavailable." }, { status: 503, headers: retiredHeaders });
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: access.providerCustomerId,
      return_url: `${canonicalApplicationOrigin()}/my-applypack/job-board`,
    });
    return NextResponse.json({ url: session.url }, { headers: retiredHeaders });
  } catch {
    return NextResponse.json({ error: "Billing management could not be opened." }, { status: 503, headers: retiredHeaders });
  }
}

const retiredHeaders = { "cache-control": "no-store, max-age=0" };
const retired = () => NextResponse.json(
  { error: "No current legacy billing entitlement was found." },
  { status: 410, headers: retiredHeaders },
);
