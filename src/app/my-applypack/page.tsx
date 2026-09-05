import type { Metadata } from "next";
import Link from "next/link";
import { DeliveryActions } from "@/components/portal/delivery-actions";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { EmailCodeSignIn } from "@/components/auth/email-code-sign-in";
import { ApplyPackSelector, type MatchForSelection } from "@/components/portal/apply-pack-selector-v2";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "My ApplyPack", robots: { index: false, follow: false } };

export default async function PortalPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <SetupState />;
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return <EmailCodeSignIn />;
  const { data: orders } = await supabase.from("orders").select("id,product_kind,amount_cents,status,delivery_deadline,delivered_at,created_at").order("created_at", { ascending: false });
  const searchOrders = (orders || []).filter((order) => order.product_kind === "job_search" && ["delivered", "delivered_refunded"].includes(order.status));
  const admin = createSupabaseAdminClient();
  const { data: approvedPackets } = admin && searchOrders.length
    ? await admin.from("job_match_packet_artifacts").select("order_id").eq("customer_id", authData.user.id).eq("status", "APPROVED").in("order_id", searchOrders.map((order) => order.id))
    : { data: [] };
  const packetOrderIds = new Set((approvedPackets || []).map((packet) => packet.order_id));
  let matches: MatchForSelection[] = [];
  if (searchOrders.length) {
    const { data } = await supabase.from("job_matches").select("id,position,fit_summary,matching_experience,primary_outcome,core_responsibilities,requirements,hidden_job_functions,concerns,ranking_reason_codes,job:jobs(company,title,source_url,official_application_url,source_name,source_category,location_text,salary_text,checked_at,listing_status,employment_type,w2_or_contractor,work_mode,remote_scope,eligible_states,eligible_countries,timezone_requirement,schedule_type,pay_model,phone_intensity,sales_flag,commission_flag,marketing_flag,high_volume_contact_center_flag,equipment_requirement,equipment_cost_responsibility,applicant_cost,benefits_status,experience_level,is_active,review_status,rejection_reason)").in("search_order_id", searchOrders.map((order) => order.id)).order("position");
    matches = (data || []).map((item) => ({
      ...item,
      concerns: Array.isArray(item.concerns) ? item.concerns.map(String) : [],
      matching_experience: Array.isArray(item.matching_experience) ? item.matching_experience.map(String) : [],
      core_responsibilities: Array.isArray(item.core_responsibilities) ? item.core_responsibilities.map(String) : [],
      requirements: Array.isArray(item.requirements) ? item.requirements.map(String) : [],
      hidden_job_functions: Array.isArray(item.hidden_job_functions) ? item.hidden_job_functions.map(String) : [],
      job: Array.isArray(item.job) ? item.job[0] : item.job,
    })).filter((item) => {
      const job = Array.isArray(item.job) ? item.job[0] : item.job;
      return job && job.review_status !== "rejected" && job.rejection_reason !== "hard_exclusion" && !/live\s*ops/i.test([job.company, job.source_name, job.source_url, job.official_application_url].filter(Boolean).join(" "));
    }) as MatchForSelection[];
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
                {packetOrderIds.has(order.id) ? <a href={`/api/customer/search-orders/${order.id}/job-match-packet`}>Download approved job-match PDF</a> : null}
              </article>
            ))}</div>
          ) : <div className="empty-state"><h3>No orders yet.</h3><p>Complete the intake to start your first search.</p><Link href="/get-started">Get started</Link></div>}
        </section>
        {matches.length ? <ApplyPackSelector matches={matches} evaluatedAt={new Date().toISOString()} /> : null}
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

function SetupState() {
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">PRIVATE PORTAL</p><h1>My ApplyPack is ready to connect.</h1><p>The interface is built. Supabase credentials are required before customer accounts and private files can open.</p><Link className="button-link button-link--primary" href="/get-started"><span>View the intake</span></Link></section></main>;
}
