import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.enum(["resume", "cover_letter"]);
const formatSchema = z.enum(["docx", "pdf"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = (await context.params).id;
  const kind = schema.safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "Choose a document." }, { status: 400 });
  const requestedFormat = new URL(request.url).searchParams.get("format") || "docx";
  const format = formatSchema.safeParse(requestedFormat);
  if (!format.success) return NextResponse.json({ error: "Choose Word or PDF." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return NextResponse.json({ error: "Private storage is not configured." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: item } = await admin.from("apply_pack_items").select("resume_path,resume_pdf_path,cover_letter_path,cover_letter_pdf_path,orders!inner(customer_id,status)").eq("id", id).maybeSingle();
  const order = Array.isArray(item?.orders) ? item?.orders[0] : item?.orders;
  if (!item || !order || order.customer_id !== authData.user.id || order.status !== "delivered") {
    return NextResponse.json({ error: "Delivery not found." }, { status: 404 });
  }
  const path = kind.data === "resume"
    ? (format.data === "pdf" ? item.resume_pdf_path : item.resume_path)
    : (format.data === "pdf" ? item.cover_letter_pdf_path : item.cover_letter_path);
  if (!path) return NextResponse.json({ error: "Document not available." }, { status: 404 });
  const { data, error } = await admin.storage.from("customer-deliveries").createSignedUrl(path, 60, { download: true });
  if (error || !data.signedUrl) return NextResponse.json({ error: "A secure download link could not be created." }, { status: 502 });
  await admin.from("audit_logs").insert({ actor_id: authData.user.id, action: "deliverable_downloaded", entity_type: "apply_pack_item", entity_id: id, details: { kind: kind.data, format: format.data } });
  const response = NextResponse.redirect(data.signedUrl, { status: 303 });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
