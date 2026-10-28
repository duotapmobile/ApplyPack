import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutStatus } from "@/components/commerce/checkout-status";
import { MaterialCheckoutStatus } from "@/components/commerce/material-checkout-status";
import { z } from "zod";
import { checkoutCookieSettings, parseCheckoutCapability } from "@/lib/commerce/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Checkout status", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string | string[]; cancelled?: string; checkout_kind?: string | string[]; material_checkout_id?: string | string[] }>;
}) {
  const parameters = await searchParams;
  // An explicit pack return takes precedence over a surviving search cookie.
  // This UUID locates a checkout; its status endpoint still verifies ownership.
  if (parameters.checkout_kind === "apply_pack" || parameters.material_checkout_id !== undefined) {
    const materialId = z.uuid().safeParse(parameters.material_checkout_id);
    if (!materialId.success || parameters.checkout_kind !== "apply_pack") return <StatusCard title="Apply Pack checkout cannot be identified" message="Open My ApplyPack to check your orders." />;
    return <MaterialCheckoutStatus checkoutIntentId={materialId.data} cancelled={parameters.cancelled === "1"} />;
  }
  if (parameters.checkout_kind !== undefined) {
    if (parameters.checkout_kind !== "search") return <StatusCard title="Checkout cannot be identified" message="Open My ApplyPack to check your orders." />;
    const settings = checkoutCookieSettings();
    const store = await cookies();
    const correctedCapability = parseCheckoutCapability(store.get(settings.name)?.value);
    if (correctedCapability) return <CheckoutStatus cancelled={parameters.cancelled === "1"} />;
    return <StatusCard title="Search checkout cannot be identified" message="Open My ApplyPack to check your orders in the account that placed them." />;
  }

  // Previously created provider sessions retain their original unmarked URLs.
  // A leftover search cookie cannot tell which product just returned. A legacy
  // session ID permits its own authenticated lookup; otherwise show no payment
  // or cancellation claim and perform no search cancellation.
  const legacySession = z.string().regex(/^cs_(?:test_|live_)?[A-Za-z0-9]+$/).safeParse(parameters.session_id);
  if (!legacySession.success) return <StatusCard title="Check your order in My ApplyPack" message="This return does not identify a checkout. Open My ApplyPack to check its verified payment and delivery status. Returning here does not confirm cancellation or a refund." />;
  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();
  if (!supabase || !admin) return <StatusCard title="Checkout status is unavailable" message="The private order service is not connected." />;
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    const next = "/checkout/return?" + new URLSearchParams({ session_id: legacySession.data }).toString();
    redirect("/sign-in?next=" + encodeURIComponent(next));
  }

  const [orderResult, cartResult] = await Promise.all([
    admin.from("orders").select("id,status,product_kind,delivery_deadline")
      .eq("stripe_checkout_session_id", legacySession.data).eq("customer_id", authData.user.id).maybeSingle(),
    admin.from("apply_pack_carts").select("id,status,delivery_deadline")
      .eq("stripe_checkout_session_id", legacySession.data).eq("customer_id", authData.user.id).maybeSingle(),
  ]);
  if (orderResult.error || cartResult.error) {
    return <StatusCard title="Payment verification is still processing" message="The browser return is not proof of payment. Refresh this page or open My ApplyPack shortly." />;
  }
  const record = orderResult.data || cartResult.data;
  if (!record) return <StatusCard title="Payment verification is still processing" message="The signed Stripe webhook has not linked this checkout yet. No fulfillment claim is shown until verification completes." />;
  const verified = !["pending_payment", "checkout_pending", "payment_expired", "expired", "cancelled"].includes(record.status);
  if (!verified || !record.delivery_deadline) {
    return <StatusCard title="Payment verification is still processing" message="ApplyPack has not yet recorded verified payment. Refresh this page; do not submit a second payment." />;
  }
  const deadline = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full", timeStyle: "short", timeZone: "America/New_York",
  }).format(new Date(record.delivery_deadline));
  return <StatusCard title="Payment verified" message={"Your order is confirmed. The contractual delivery deadline is " + deadline + " ET."} />;
}

function StatusCard({ title, message }: { title: string; message: string }) {
  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card" aria-live="polite">
        <p className="eyebrow">SECURE CHECKOUT</p>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="admin-buttons">
          <Link className="button-link button-link--primary" href="/my-applypack"><span>Open My ApplyPack</span></Link>
          <Link href="/contact">Get help</Link>
        </div>
      </section>
    </main>
  );
}
