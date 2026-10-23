import { NextResponse } from "next/server";
import { z } from "zod";
import { canonicalApplicationOrigin } from "@/lib/commerce/server";
import { validateDocumentBytes } from "@/lib/files/document-safety";
import { extractIsolatedDocument } from "@/lib/files/isolated-extraction";
import { docxMimeType } from "@/lib/files/signatures";
import { MATERIAL_DOWNLOAD_SECONDS } from "@/lib/materials/contract";
import { legacyDeliveryPath, legacyDocumentKinds, type LegacyDeliveryRevision } from "@/lib/materials/legacy-delivery";
import { verifiedAuthenticationAt, isFreshAuthentication } from "@/lib/materials/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "no-store, private", Pragma: "no-cache",
  "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

function requireSignIn(request: Request, itemId: string, history: boolean) {
  const signInPath = `/sign-in?next=${encodeURIComponent(`/my-applypack#historical-delivery-${itemId}`)}`;
  if (!history && request.headers.get("accept")?.includes("text/html")) {
    try { return NextResponse.redirect(new URL(signInPath, canonicalApplicationOrigin()), { status: 303, headers }); }
    catch { return fail("Private delivery is not configured.", 503); }
  }
  return NextResponse.json({ error: "Sign in again before requesting a new 15-minute download.",
    reauthenticationRequired: true, signInPath }, { status: 401, headers });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const itemId = z.uuid().safeParse((await context.params).id);
  const query = new URL(request.url).searchParams;
  const history = query.get("history") === "1";
  const kind = legacyDocumentKinds.safeParse(query.get("kind"));
  const revisionId = query.get("revisionId");
  if (!itemId.success || (!history && !kind.success) || (revisionId !== null && !z.uuid().safeParse(revisionId).success)) {
    return fail("Delivery not found.", 404);
  }
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return fail("Private delivery is not configured.", 503);
  const [{ data: authData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(), supabase.auth.getSession(),
  ]);
  if (!authData.user) return requireSignIn(request, itemId.data, history);
  const customerId = authData.user.id;
  const token = sessionData.session?.access_token;
  const verified = token ? await supabase.auth.getClaims(token).catch(() => null) : null;
  const authenticatedAt = verified && !verified.error ? verifiedAuthenticationAt(verified.data?.claims, customerId) : null;
  if (!isFreshAuthentication(authenticatedAt)) return requireSignIn(request, itemId.data, history);

  try {
    const { data: item, error: itemError } = await admin.from("apply_pack_items")
      .select("id,order_id,status,delivered_at,orders!inner(customer_id,product_kind)")
      .eq("id", itemId.data).maybeSingle();
    const order = Array.isArray(item?.orders) ? item.orders[0] : item?.orders;
    if (itemError || !item || !order || order.customer_id !== customerId || order.product_kind !== "apply_pack"
      || item.status !== "delivered" || !item.delivered_at) return fail("Delivery not found.", 404);

    let revisionQuery = admin.from("apply_pack_delivery_revisions")
      .select("id,apply_pack_item_id,version,correction_request_id,resume_path,cover_letter_path,delivered_at,reviewed_by")
      .eq("apply_pack_item_id", itemId.data).order("version", { ascending: false });
    if (revisionId) revisionQuery = revisionQuery.eq("id", revisionId);
    const revisions = await revisionQuery.limit(history ? 100 : 1).returns<LegacyDeliveryRevision[]>();
    if (revisions.error) return fail("Historical delivery records could not be verified. Please try again.", 503);
    const pathFor = (revision: LegacyDeliveryRevision, documentKind: "resume" | "cover_letter") => legacyDeliveryPath({
      customerId, orderId: item.order_id, itemId: itemId.data, revision, kind: documentKind,
    });
    if (history) return NextResponse.json({ versions: (revisions.data || []).map((revision) => ({
      id: revision.id, version: revision.version, deliveredAt: revision.delivered_at,
      available: Boolean(pathFor(revision, "resume") && pathFor(revision, "cover_letter")),
    })) }, { headers });
    const revision = revisions.data?.[0];
    if (!revision || !kind.success) return fail("Historical document not found. Contact support for review.", 404);
    const path = pathFor(revision, kind.data);
    if (!path) return fail("This historical file needs a safety review. Contact support; your delivery record is preserved.", 409);
    const bucket = admin.storage.from("customer-deliveries");
    const stored = await bucket.download(path);
    if (stored.error || !stored.data) return fail("This historical file is unavailable. Contact support; your delivery record is preserved.", 404);
    if (stored.data.size < 1 || stored.data.size > 10 * 1024 * 1024) return fail("This historical file needs a safety review. Contact support.", 409);
    const bytes = Buffer.from(await stored.data.arrayBuffer());
    try {
      if (!validateDocumentBytes(bytes, docxMimeType).safe) return fail("This historical file needs a safety review. Contact support.", 409);
      // Apply the same isolated structural policy used by current private intake.
      // Historical content is inspected, never regenerated or passed to a model.
      await extractIsolatedDocument(bytes, docxMimeType);
      const signed = await bucket.createSignedUrl(path, MATERIAL_DOWNLOAD_SECONDS, {
        download: `ApplyPack_${kind.data}_version_${revision.version}.docx`,
      });
      if (signed.error || !signed.data?.signedUrl) return fail("A secure download could not be created. Please try again.", 502);
      return NextResponse.redirect(signed.data.signedUrl, { status: 303, headers });
    } finally { bytes.fill(0); }
  } catch {
    return fail("Historical delivery could not be verified. Please try again later.", 503);
  }
}
