import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { notifyCustomer } from "@/lib/email/notify";

const jobSchema = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  sourceUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  location: z.string().trim().max(300).optional().default(""),
  salary: z.string().trim().max(200).optional().default(""),
  fitSummary: z.string().trim().min(20).max(3000),
  requirements: z.array(z.string().max(500)).max(30).default([]),
  concerns: z.array(z.string().max(500)).max(30).default([]),
  checkedAt: z.iso.datetime(),
});
const schema = z.object({ matches: z.array(jobSchema).length(10) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const orderId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Exactly 10 complete, current matches are required.", details: parsed.error.flatten() }, { status: 400 });
  const { data: order } = await auth.admin.from("orders").select("id,customer_id,intake_id,product_kind,status").eq("id", orderId).maybeSingle();
  if (!order || order.product_kind !== "job_search" || !["paid", "in_fulfillment"].includes(order.status)) {
    return NextResponse.json({ error: "Search order is not deliverable." }, { status: 409 });
  }
  const freshnessMs = Number(process.env.APP_JOB_FRESHNESS_HOURS || 24) * 60 * 60 * 1000;
  if (parsed.data.matches.some((match) => Date.now() - new Date(match.checkedAt).getTime() > freshnessMs)) {
    return NextResponse.json({ error: "Every listing must be rechecked within the configured freshness window." }, { status: 409 });
  }
  const { count } = await auth.admin.from("job_matches").select("id", { count: "exact", head: true }).eq("search_order_id", orderId);
  if (count) return NextResponse.json({ error: "Matches already exist for this order." }, { status: 409 });
  const { data: jobs, error: jobsError } = await auth.admin.from("jobs").insert(parsed.data.matches.map((match) => ({
    company: match.company,
    title: match.title,
    source_url: match.sourceUrl,
    location_text: match.location || null,
    salary_text: match.salary || null,
    checked_at: match.checkedAt,
  }))).select("id");
  if (jobsError || !jobs || jobs.length !== 10) return NextResponse.json({ error: "Jobs could not be saved." }, { status: 502 });
  const rows = parsed.data.matches.map((match, index) => ({
    search_order_id: orderId,
    job_id: jobs[index].id,
    position: index + 1,
    fit_summary: match.fitSummary,
    requirements: match.requirements,
    concerns: match.concerns,
    delivered_at: new Date().toISOString(),
  }));
  const { error: matchError } = await auth.admin.from("job_matches").insert(rows);
  if (matchError) {
    await auth.admin.from("jobs").delete().in("id", jobs.map((job) => job.id));
    return NextResponse.json({ error: "Matches could not be saved." }, { status: 502 });
  }
  await auth.admin.from("orders").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", orderId);
  if (order.intake_id) {
    const retentionDays = Math.max(1, Number(process.env.APP_SOURCE_DOCUMENT_RETENTION_DAYS || 30));
    await auth.admin.from("intakes").update({
      source_retention_due_at: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
    }).eq("id", order.intake_id);
  }
  await auth.admin.from("audit_logs").insert({ actor_id: auth.user.id, action: "search_delivered", entity_type: "order", entity_id: orderId, details: { match_count: 10 } });
  await notifyCustomer({
    customerId: order.customer_id,
    orderId,
    template: "search_delivery",
    subject: "Your 10 ApplyPack job matches are ready",
    lines: ["Your researched job matches are ready in My ApplyPack.", "Review each employer listing before deciding whether to apply."],
  });
  return NextResponse.json({ ok: true });
}
