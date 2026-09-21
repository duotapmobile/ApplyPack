import type { Metadata } from "next";
import Link from "next/link";
import { DeliveryActions } from "@/components/portal/delivery-actions";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { EmailCodeSignIn } from "@/components/auth/email-code-sign-in";
import { ApplyPackSelector } from "@/components/portal/apply-pack-selector-v2";
import { MaterialDeliveries } from "@/components/portal/material-deliveries";
import { ReferenceManager } from "@/components/portal/reference-manager";
import { SearchOrderProgress, type SearchOrderProgressView } from "@/components/portal/search-order-progress";
import { loadDeliveredMatchGroups, loadMaterialDeliveries } from "@/lib/materials/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My ApplyPack", robots: { index: false, follow: false } };

export default async function PortalPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <SetupState />;
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return <EmailCodeSignIn />;

  const { data: orders } = await supabase.from("orders")
    .select("id,product_kind,amount_cents,status,delivery_deadline,delivered_at,created_at")
    .order("created_at", { ascending: false });
  const searchOrders = (orders || []).filter((order) => order.product_kind === "job_search");
  const searchOrderIds = searchOrders.map((order) => order.id);
  const { data: services } = searchOrderIds.length
    ? await supabase.from("ap_search_services")
      .select("id,legacy_order_id,winning_payment_attempt_id,original_snapshot_id,fulfillment,adjustment,delivery_due_at,capacity_exception_at,refund_started_at,legacy_record")
      .in("legacy_order_id", searchOrderIds)
    : { data: [] };
  const serviceIds = (services || []).map((service) => service.id);
  const paymentIds = (services || []).map((service) => service.winning_payment_attempt_id).filter((id): id is string => Boolean(id));
  const [{ data: amendments }, { data: refunds }, { data: releases }] = await Promise.all([
    serviceIds.length
      ? supabase.from("ap_criteria_amendments")
        .select("id,search_service_id,state,current_valid_count,reason_codes,blocking_constraints,criteria_diff,proposed_snapshot_patch,proposal_expires_at,estimated_revision_seconds,revision_due_at,created_at")
        .in("search_service_id", serviceIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    paymentIds.length
      ? supabase.from("ap_refund_operations")
        .select("payment_attempt_id,scope,state,superseded_at,created_at")
        .in("payment_attempt_id", paymentIds).eq("scope", "FULL_SEARCH").is("superseded_at", null)
      : Promise.resolve({ data: [] }),
    searchOrderIds.length
      ? supabase.from("ap_releases")
        .select("id,order_id,committed_at,release_kind")
        .in("order_id", searchOrderIds).eq("release_kind", "SEARCH_EXACT_TEN")
      : Promise.resolve({ data: [] }),
  ]);

  const amendmentsByService = new Map<string, NonNullable<typeof amendments>[number]>();
  for (const amendment of amendments || []) {
    if (!amendmentsByService.has(amendment.search_service_id)) amendmentsByService.set(amendment.search_service_id, amendment);
  }
  const refundsByPayment = new Map<string, Array<{ payment_attempt_id: string; state: string }>>();
  for (const refund of refunds || []) {
    const current = refundsByPayment.get(refund.payment_attempt_id) || [];
    current.push({ payment_attempt_id: refund.payment_attempt_id, state: refund.state });
    refundsByPayment.set(refund.payment_attempt_id, current);
  }
  const releaseOrderIds = new Set((releases || []).map((release) => release.order_id));
  const searchProgress: SearchOrderProgressView[] = (services || []).map((service) => {
    const refundState = fullRefundState(service.winning_payment_attempt_id ? refundsByPayment.get(service.winning_payment_attempt_id) || [] : []);
    const amendment = amendmentsByService.get(service.id);
    const state = customerSearchState(service, refundState, releaseOrderIds.has(service.legacy_order_id));
    return {
      orderId: service.legacy_order_id,
      stateLabel: state.label,
      stateMessage: state.message,
      dueAt: service.delivery_due_at,
      refundState,
      adjustment: amendment ? {
        id: amendment.id,
        state: amendment.state,
        currentValidCount: amendment.current_valid_count,
        reasonCodes: stringArray(amendment.reason_codes),
        blockingConstraints: jsonObject(amendment.blocking_constraints),
        criteriaDiff: jsonObject(amendment.criteria_diff),
        proposedSnapshotPatch: jsonObject(amendment.proposed_snapshot_patch),
        proposalExpiresAt: amendment.proposal_expires_at,
        estimatedDueAt: amendment.state === "PROPOSED" && amendment.estimated_revision_seconds
          ? new Date(new Date(amendment.created_at).getTime() + amendment.estimated_revision_seconds * 1_000).toISOString()
          : null,
        revisionDueAt: amendment.revision_due_at,
      } : null,
    };
  });

  let releasePortal = { groups: [], jobs: [] } as Awaited<ReturnType<typeof loadDeliveredMatchGroups>>;
  let materialDeliveries: Awaited<ReturnType<typeof loadMaterialDeliveries>> = [];
  let portalDataUnavailable = false;
  try {
    [releasePortal, materialDeliveries] = await Promise.all([
      loadDeliveredMatchGroups({ supabase, releases: releases || [], services: services || [] }),
      loadMaterialDeliveries({ supabase, customerId: authData.user.id }),
    ]);
  } catch {
    portalDataUnavailable = true;
  }

  const { data: deliveryItems } = await supabase.from("apply_pack_items")
    .select("id,status,delivered_at,job_match:job_matches(jobs(company,title))")
    .not("delivered_at", "is", null).order("delivered_at", { ascending: false });
  return (
    <main id="main-content" className="portal-page">
      <div className="page-frame">
        <div className="portal-hero"><div><p className="eyebrow eyebrow--light">MY APPLYPACK</p><h1>Your search, decisions, and deliveries.</h1></div><div><p>Signed in as {authData.user.email}</p><SignOutButton /></div></div>
        <section className="portal-section">
          <div className="portal-section__heading"><div><p className="eyebrow">ORDERS</p><h2>Current work</h2></div><Link href="/get-started">Start another search</Link></div>
          {orders?.length ? (
            <div className="order-list">{orders.map((order) => (
              <article key={order.id}>
                <div><span>{order.product_kind === "job_search" ? "10 Researched Job Matches" : "Tailored Resume + Cover Letter"}</span><strong>{order.status.replaceAll("_", " ")}</strong></div>
                <p>Order {order.id.slice(0, 8).toUpperCase()}</p>
                <p>{"$" + (order.amount_cents / 100).toFixed(2)}</p>
                {order.delivery_deadline ? <p>Due {new Date(order.delivery_deadline).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p> : null}
              </article>
            ))}</div>
          ) : <div className="empty-state"><h3>No orders yet.</h3><p>Complete the intake to start your first search.</p><Link href="/get-started">Get started</Link></div>}
        </section>
        <SearchOrderProgress searches={searchProgress} />
        {portalDataUnavailable ? <section className="portal-section"><div className="match-warning"><strong>Private materials data is temporarily unavailable.</strong> No purchase or download action is enabled until the exact release records can be verified.</div></section> : null}
        {releasePortal.groups.map((group) => <ApplyPackSelector
          key={group.deliveredReleaseId}
          matches={group.matches}
          evaluatedAt={group.evaluatedAt}
          deliveredOrderId={group.deliveredOrderId}
          deliveredReleaseId={group.deliveredReleaseId}
          sourceSnapshotId={group.sourceSnapshotId}
          initialEmail={authData.user.email || ""}
        />)}
        {releasePortal.groups.length ? <ReferenceManager deliveredJobs={releasePortal.jobs} /> : null}
        <MaterialDeliveries lines={materialDeliveries} />
        {deliveryItems?.length ? (
          <section className="portal-section">
            <div className="portal-section__heading"><div><p className="eyebrow">DELIVERIES</p><h2>Your documents</h2></div><p>Download, review, and edit every document before submitting it to an employer.</p></div>
            <div className="delivery-list">
              {deliveryItems.map((item) => {
                const match = Array.isArray(item.job_match) ? item.job_match[0] : item.job_match;
                const job = Array.isArray(match?.jobs) ? match?.jobs[0] : match?.jobs;
                return (
                  <article key={item.id}>
                    <div><span>DELIVERED</span><h3>{job?.title || "Selected job"}</h3><p>{job?.company || "Employer"}</p></div>
                    <DeliveryActions itemId={item.id} deliveredAt={item.delivered_at!} jobLabel={(job?.company || "Employer") + " " + (job?.title || "selected job")} />
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function fullRefundState(refunds: Array<{ state: string }>): SearchOrderProgressView["refundState"] {
  if (refunds.some((refund) => refund.state === "SUCCEEDED")) return "SUCCEEDED";
  if (refunds.some((refund) => refund.state === "PENDING")) return "PENDING";
  if (refunds.some((refund) => refund.state === "FAILED")) return "FAILED";
  return "NONE";
}

function customerSearchState(
  service: { fulfillment: string; adjustment: string; capacity_exception_at: string | null; refund_started_at: string | null },
  refundState: SearchOrderProgressView["refundState"],
  released: boolean,
) {
  if (refundState === "SUCCEEDED") return { label: "Refunded", message: "The payment provider confirmed the full refund. No search release was committed." };
  if (refundState === "PENDING") return { label: "Refund processing", message: "A required full refund is in progress. Its durable provider state is preserved here." };
  if (refundState === "FAILED") return { label: "Refund problem", message: "The full refund needs staff attention. The order and retry record remain preserved." };
  if (released || service.fulfillment === "DELIVERED") return { label: "Delivered", message: "The immutable exact-ten release is available below." };
  if (service.adjustment === "PROPOSED" || service.fulfillment === "ADJUSTMENT_REQUIRED") return { label: "Adjustment required", message: "We could not verify ten jobs under the active criteria. Review the precise proposal below." };
  if (service.capacity_exception_at) return { label: "Capacity problem", message: "Work did not start after payment because capacity could not be confirmed. A full refund is required." };
  if (service.refund_started_at) return { label: "Refund processing", message: "A required full refund has started and no release will be committed." };
  if (service.fulfillment === "HUMAN_REVIEW") return { label: "Human review", message: "A staff reviewer is checking eligibility evidence, liveness, provenance, and the exact-ten package." };
  if (service.fulfillment === "READY_TO_RELEASE") return { label: "Final release review", message: "Ten eligible jobs are ready for the final human release decision." };
  return { label: "Researching", message: "Payment and capacity are verified. We are researching and checking current listings against the active criteria." };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)) : [];
}

function SetupState() {
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">PRIVATE PORTAL</p><h1>My ApplyPack is ready to connect.</h1><p>The interface is built. Supabase credentials are required before customer accounts and private files can open.</p><Link className="button-link button-link--primary" href="/get-started"><span>View the intake</span></Link></section></main>;
}
