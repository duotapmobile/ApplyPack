import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminOperations } from "@/components/admin/admin-operations";
import { isAdminEmailAllowed } from "@/lib/auth/require-admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ApplyPack Operations", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return <AdminSetup />;
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/sign-in");
  if (!isAdminEmailAllowed(authData.user.email)) redirect("/my-applypack");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (!profile || !["operator", "admin"].includes(profile.role)) redirect("/my-applypack");
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") return <MfaRequired />;
  const [{ data: orders }, { data: capacity }, { data: failures }, { data: applyRows }, { data: conflictRows }, { data: correctionRows }, { data: capacityLimits }] = await Promise.all([
    admin.from("orders").select("id,product_kind,status,amount_cents,delivery_deadline,created_at,intake_id,intake:intakes(email,direction,priorities,dealbreakers,location_preference,schedule_preference,minimum_salary,experience_summary,notes,cover_letter_path,source_scan_status,source_deleted_at,intake_answers(answers))").in("status", ["paid", "in_fulfillment"]).order("delivery_deadline"),
    admin.from("capacity_reservations").select("id,kind,units,status,reserved_at,expires_at,confirmed_at").in("status", ["reserved", "confirmed"]).order("reserved_at", { ascending: false }),
    admin.from("webhook_events").select("id,event_type,error_message,received_at").not("error_message", "is", null).order("received_at", { ascending: false }).limit(10),
    admin.from("apply_pack_items").select("id,order_id,emphasis_notes,do_not_mention_notes,customer_update_notes,orders!inner(status),job_match:job_matches(job:jobs(company,title))").in("orders.status", ["paid", "in_fulfillment"]).neq("status", "delivered"),
    admin.from("conflict_reviews").select("id,explanation,job_match:job_matches(job:jobs(company,title))").eq("status", "submitted").order("created_at"),
    admin.from("correction_requests").select("id,correction_text,apply_pack_item:apply_pack_items(job_match:job_matches(job:jobs(company,title)))").eq("status", "submitted").order("created_at"),
    admin.from("capacity_limits").select("kind,units_per_24h,enabled").order("kind"),
  ]);
  const applyItems = (applyRows || []).map((item) => {
    const match = Array.isArray(item.job_match) ? item.job_match[0] : item.job_match;
    const job = Array.isArray(match?.job) ? match.job[0] : match?.job;
    return { id: item.id, order_id: item.order_id, emphasis_notes: item.emphasis_notes, do_not_mention_notes: item.do_not_mention_notes, customer_update_notes: item.customer_update_notes, company: job?.company || "Employer", title: job?.title || "Selected job" };
  });
  const conflicts = (conflictRows || []).map((item) => {
    const match = Array.isArray(item.job_match) ? item.job_match[0] : item.job_match;
    const job = Array.isArray(match?.job) ? match.job[0] : match?.job;
    return { id: item.id, explanation: item.explanation, company: job?.company || "Employer", title: job?.title || "Matched job" };
  });
  const corrections = (correctionRows || []).map((item) => {
    const pack = Array.isArray(item.apply_pack_item) ? item.apply_pack_item[0] : item.apply_pack_item;
    const match = Array.isArray(pack?.job_match) ? pack.job_match[0] : pack?.job_match;
    const job = Array.isArray(match?.job) ? match.job[0] : match?.job;
    return { id: item.id, correction_text: item.correction_text, company: job?.company || "Employer", title: job?.title || "Apply Pack" };
  });
  const searchOrders = (orders || []).filter((order) => order.product_kind === "job_search").map((order) => {
    const intake = Array.isArray(order.intake) ? order.intake[0] : order.intake;
    const answerRow = Array.isArray(intake?.intake_answers) ? intake.intake_answers[0] : intake?.intake_answers;
    return {
      id: order.id,
      delivery_deadline: order.delivery_deadline,
      intake_id: order.intake_id,
      source_scan_status: intake?.source_scan_status || "pending",
      source_deleted: Boolean(intake?.source_deleted_at),
      has_cover_letter: Boolean(intake?.cover_letter_path),
      intake_details: intake ? { email: intake.email, direction: intake.direction, priorities: intake.priorities, dealbreakers: intake.dealbreakers, location_preference: intake.location_preference, schedule_preference: intake.schedule_preference, minimum_salary: intake.minimum_salary, experience_summary: intake.experience_summary, notes: intake.notes, answers: answerRow?.answers } : {},
    };
  });
  return (
    <main id="main-content" className="admin-page">
      <div className="page-frame">
        <div className="admin-heading"><div><p className="eyebrow eyebrow--light">APPLYPACK OPERATIONS</p><h1>Fulfillment queue</h1></div><p>Manual-first controls. Every delivery requires human review.</p></div>
        <div className="admin-metrics"><article><span>Open work</span><strong>{orders?.length || 0}</strong></article><article><span>Active capacity units</span><strong>{capacity?.reduce((sum, item) => sum + item.units, 0) || 0}</strong></article><article><span>Webhook failures</span><strong>{failures?.length || 0}</strong></article></div>
        <AdminOperations searchOrders={searchOrders} applyItems={applyItems} conflicts={conflicts} corrections={corrections} capacityLimits={capacityLimits || []} />
        <section className="admin-table-wrap">
          <h2>Orders due</h2>
          {orders?.length ? <div className="admin-table" role="table">{orders.map((order) => <article role="row" key={order.id}><div role="cell"><strong>{order.product_kind.replaceAll("_", " ")}</strong><span>{order.id}</span></div><span role="cell">{order.status.replaceAll("_", " ")}</span><span role="cell">{"$" + (order.amount_cents / 100).toFixed(2)}</span><span role="cell">{order.delivery_deadline ? new Date(order.delivery_deadline).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "Awaiting deadline"}</span></article>)}</div> : <p>No paid work is waiting.</p>}
        </section>
        {failures?.length ? <section className="admin-alerts"><h2>Provider failures</h2>{failures.map((failure) => <p key={failure.id}><strong>{failure.event_type}</strong> {failure.error_message}</p>)}</section> : null}
      </div>
    </main>
  );
}

function AdminSetup() {
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">OPERATIONS</p><h1>Provider setup required.</h1><p>Supabase server credentials must be connected before the private operator queue can open.</p></section></main>;
}

function MfaRequired() {
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">ADMIN SECURITY</p><h1>MFA verification required.</h1><p>Enroll and verify a Supabase authenticator factor before opening ApplyPack operations.</p></section></main>;
}
