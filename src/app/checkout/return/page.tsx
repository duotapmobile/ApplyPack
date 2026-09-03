import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Checkout status", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; cancelled?: string }>;
}) {
  const parameters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return <StatusCard title="Checkout status is unavailable" message="The private order service is not connected." />;
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    const next = "/checkout/return?" + new URLSearchParams(parameters as Record<string, string>).toString();
    redirect("/sign-in?next=" + encodeURIComponent(next));
  }
  if (parameters.cancelled === "1") {
    return <StatusCard title="Checkout was cancelled" message="No browser cancellation is recorded as payment. Return to My ApplyPack when you are ready." />;
  }
  if (!parameters.session_id || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(parameters.session_id)) {
    return <StatusCard title="Checkout status cannot be identified" message="Open My ApplyPack to see the verified state of every order." />;
  }

  const [orderResult, cartResult] = await Promise.all([
    admin.from("orders").select("id,status,product_kind,delivery_deadline")
      .eq("stripe_checkout_session_id", parameters.session_id).eq("customer_id", authData.user.id).maybeSingle(),
    admin.from("apply_pack_carts").select("id,status,delivery_deadline")
      .eq("stripe_checkout_session_id", parameters.session_id).eq("customer_id", authData.user.id).maybeSingle(),
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
          <Link href="/help">Get help</Link>
        </div>
      </section>
    </main>
  );
}
