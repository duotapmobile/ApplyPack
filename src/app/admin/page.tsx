import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminMfa } from "@/components/admin/admin-mfa";
import { AdminOperations } from "@/components/admin/admin-operations";
import { PendingIntakes } from "@/components/admin/pending-intakes";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { isAdminEmailAllowed } from "@/lib/auth/require-admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { candidatePayload } from "@/lib/workflow/candidates";

export const metadata: Metadata = { title: "ApplyPack Operations", robots: { index: false, follow: false } };
type RenderedPacketJob = { job_id: string; title: string; employer: string; unknown_warnings: { field: string; status: string }[] };

function renderedPacketJobs(snapshot: unknown): RenderedPacketJob[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const jobs = (snapshot as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const warnings = Array.isArray(row.unknownWarnings) ? row.unknownWarnings.flatMap((warning) => {
      if (!warning || typeof warning !== "object" || Array.isArray(warning)) return [];
      const item = warning as Record<string, unknown>;
      return typeof item.field === "string" && typeof item.status === "string"
        ? [{ field: item.field, status: item.status }]
        : [];
    }) : [];
    if (typeof row.jobId !== "string" || typeof row.positionTitle !== "string" || typeof row.employerName !== "string") return [];
    return [{
      job_id: row.jobId,
      title: row.positionTitle,
      employer: row.employerName,
      unknown_warnings: warnings,
    }];
  });
}


export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return <AdminSetup />;
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/sign-in?next=/admin");
  if (!isAdminEmailAllowed(authData.user.email)) redirect("/my-applypack");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (!profile || !["operator", "admin"].includes(profile.role)) redirect("/my-applypack");
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") return <AdminMfa />;
  const [{ data: orders }, { data: capacity }, { data: failures }, { data: applyRows }, { data: conflictRows }, { data: correctionRows }, { data: capacityLimits }, { data: candidateRows }] = await Promise.all([
    admin.from("orders").select("id,product_kind,status,amount_cents,delivery_deadline,created_at,intake_id,intake:intakes(email,direction,priorities,dealbreakers,location_preference,schedule_preference,minimum_salary,experience_summary,notes,cover_letter_path,source_scan_status,source_deleted_at,intake_answers(answers))").in("status", ["paid", "in_fulfillment"]).order("delivery_deadline"),
    admin.from("capacity_reservations").select("id,kind,units,status,reserved_at,expires_at,confirmed_at").in("status", ["reserved", "confirmed"]).order("reserved_at", { ascending: false }),
    admin.from("webhook_events").select("id,event_type,error_message,received_at").not("error_message", "is", null).order("received_at", { ascending: false }).limit(10),
    admin.from("apply_pack_items").select("id,order_id,status,emphasis_notes,do_not_mention_notes,customer_update_notes,draft_resume_path,draft_cover_letter_path,draft_generated_at,draft_generator_version,orders!inner(status),job_match:job_matches(job:jobs(company,title))").in("orders.status", ["paid", "in_fulfillment"]).neq("status", "delivered"),
    admin.from("conflict_reviews").select("id,explanation,job_match:job_matches(job:jobs(company,title))").eq("status", "submitted").order("created_at"),
    admin.from("correction_requests").select("id,correction_text,apply_pack_item:apply_pack_items(job_match:job_matches(job:jobs(company,title)))").eq("status", "submitted").order("created_at"),
    admin.from("capacity_limits").select("kind,units_per_24h,enabled").order("kind"),
    admin.from("search_candidates").select("search_order_id,ranking_score,fit_summary,requirements,concerns,job:jobs(*)").eq("review_status", "proposed").order("ranking_score", { ascending: false }),
  ]);
  const { data: pendingRequests } = await admin.from("ap_feasibility_requests").select("id,snapshot_id,state,created_at").eq("state", "PENDING").order("created_at");
  const [{ data: packetOrderRows }, { data: packetArtifactRows }] = await Promise.all([
    admin.from("orders").select("id,delivered_at,status").eq("product_kind", "job_search").in("status", ["delivery_processing", "delivered"]).order("updated_at", { ascending: false }).limit(25),
    admin.from("job_match_packet_artifacts").select("id,order_id,status,checksum_sha256,renderer_version,template_version,content_snapshot,created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  const pendingSnapshotIds = (pendingRequests || []).map((request) => request.snapshot_id);
  const { data: pendingSnapshots } = pendingSnapshotIds.length
    ? await admin.from("ap_intake_snapshots").select("id,access_email_normalized,desired_activities,avoided_activities,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,dealbreakers,salary_hard_minimum_cents,salary_period,finalized_at").in("id", pendingSnapshotIds)
    : { data: [] };
  const applyItems = (applyRows || []).map((item) => {
    const match = Array.isArray(item.job_match) ? item.job_match[0] : item.job_match;
    const job = Array.isArray(match?.job) ? match.job[0] : match?.job;
    return { id: item.id, order_id: item.order_id, status: item.status, emphasis_notes: item.emphasis_notes, do_not_mention_notes: item.do_not_mention_notes, customer_update_notes: item.customer_update_notes, draft_resume_path: item.draft_resume_path, draft_cover_letter_path: item.draft_cover_letter_path, draft_generated_at: item.draft_generated_at, draft_generator_version: item.draft_generator_version, company: job?.company || "Employer", title: job?.title || "Selected job" };
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
  const candidatesByOrder = new Map<string, ReturnType<typeof candidatePayload>[]>();
  for (const candidate of candidateRows || []) {
    const job = Array.isArray(candidate.job) ? candidate.job[0] : candidate.job;
    if (!job) continue;
    const current = candidatesByOrder.get(candidate.search_order_id) || [];
    current.push(candidatePayload(candidate as unknown as Record<string, unknown>, job as unknown as Record<string, unknown>));
    candidatesByOrder.set(candidate.search_order_id, current);
  }
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
      suggested_matches: candidatesByOrder.get(order.id) || [],
    };
  });
  const latestPacketByOrder = new Map<string, NonNullable<typeof packetArtifactRows>[number]>();
  for (const artifact of packetArtifactRows || []) if (!latestPacketByOrder.has(artifact.order_id)) latestPacketByOrder.set(artifact.order_id, artifact);
  const packetOrders = (packetOrderRows || []).map((order) => { const artifact = latestPacketByOrder.get(order.id); return { ...order, artifact: artifact ? { ...artifact, rendered_jobs: renderedPacketJobs(artifact.content_snapshot) } : null }; });
  return (
    <main id="main-content" className="admin-page">
      <div className="page-frame">
        <div className="admin-heading"><div><p className="eyebrow eyebrow--light">APPLYPACK OPERATIONS</p><h1>Fulfillment queue</h1></div><div><p>Manual-first controls. Every delivery requires human review.</p><SignOutButton /></div></div>
        <div className="admin-metrics"><article><span>Open work</span><strong>{orders?.length || 0}</strong></article><article><span>Active capacity units</span><strong>{capacity?.reduce((sum, item) => sum + item.units, 0) || 0}</strong></article><article><span>Webhook failures</span><strong>{failures?.length || 0}</strong></article></div>
        <AdminOperations searchOrders={searchOrders} packetOrders={packetOrders} applyItems={applyItems} conflicts={conflicts} corrections={corrections} capacityLimits={capacityLimits || []} />
        <PendingIntakes requests={pendingRequests || []} snapshots={pendingSnapshots || []} />
        <section className="admin-table-wrap">
          <h2>Orders due</h2>
          {orders?.length ? <div className="admin-table-scroll"><table className="admin-table">
            <caption className="sr-only">Paid ApplyPack work ordered by delivery deadline</caption>
            <thead><tr><th scope="col">Product and order</th><th scope="col">Status</th><th scope="col">Amount</th><th scope="col">Deadline</th></tr></thead>
            <tbody>{orders.map((order) => <tr key={order.id}>
              <th scope="row"><strong>{order.product_kind.replaceAll("_", " ")}</strong><span>{order.id}</span></th>
              <td>{order.status.replaceAll("_", " ")}</td>
              <td>{"$" + (order.amount_cents / 100).toFixed(2)}</td>
              <td>{order.delivery_deadline ? new Date(order.delivery_deadline).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "Awaiting deadline"}</td>
            </tr>)}</tbody>
          </table></div> : <p>No paid work is waiting.</p>}
        </section>
        {failures?.length ? <section className="admin-alerts"><h2>Provider failures</h2>{failures.map((failure) => <p key={failure.id}><strong>{failure.event_type}</strong> {failure.error_message}</p>)}</section> : null}
      </div>
    </main>
  );
}

function AdminSetup() {
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">OPERATIONS</p><h1>Provider setup required.</h1><p>Supabase server credentials must be connected before the private operator queue can open.</p></section></main>;
}
