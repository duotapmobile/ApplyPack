import { z } from "zod";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serviceErrorReportSchema } from "@/lib/materials/service-error-contract";
import { createCustomerServiceErrors } from "@/lib/materials/service-error-server";
import { readServiceErrorInput, serviceErrorResponse, serviceErrorFailure } from "@/lib/materials/service-error-http";

type Route = { params: Promise<{ id: string }> };
async function authenticate(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: serviceErrorResponse({ error: "Secure support is unavailable." }, 503) };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: serviceErrorResponse({ error: "Sign in to view your delivery." }, 401) };
  const admin = createSupabaseAdminClient({ signal: request.signal });
  if (!admin) return { error: serviceErrorResponse({ error: "Secure support is unavailable." }, 503) };
  return { customerId: data.user.id, service: createCustomerServiceErrors(admin, data.user.id) };
}
export async function GET(request: Request, route: Route) {
  try {
    const lineId = z.uuid().safeParse((await route.params).id);
    if (!lineId.success) return serviceErrorResponse({ error: "Delivery not found." }, 404);
    const auth = await authenticate(request); if (auth.error) return auth.error;
    const requestId = new URL(request.url).searchParams.get("requestId"), signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    if (requestId !== null) {
      const parsed = z.uuid().safeParse(requestId); if (!parsed.success) return serviceErrorResponse({ error: "Request ID is invalid." }, 400);
      const receipt = await auth.service!.receipt(parsed.data, signal);
      if (receipt && receipt.materialLineId !== lineId.data) return serviceErrorResponse({ error: "Report not found." }, 404);
      return serviceErrorResponse({ receipt });
    }
    const context = await auth.service!.context(lineId.data, signal);
    // Legal receipt digests and internal snapshot identities are not needed by
    // the customer report form. The server retains all authority checks.
    return serviceErrorResponse({ materialLineId: lineId.data, reportDeadline: context.reportDeadline,
      reportingTimeZone: context.contract!.reportingTimeZone, files: context.files, existingReport: context.existingReport ?? null });
  } catch (error) { return serviceErrorFailure(error); }
}
export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This request was rejected." }, 403);
  try {
    const lineId = z.uuid().safeParse((await route.params).id), auth = await authenticate(request); if (auth.error) return auth.error;
    const input = serviceErrorReportSchema.safeParse(await readServiceErrorInput(request));
    if (!lineId.success || !input.success || input.data.materialLineId !== lineId.data) return serviceErrorResponse({ error: "Review each document and complete the report details." }, 400);
    const rate = await consumeRateLimit({ request, scope: "material_service_error_report", identity: auth.customerId!, limit: 10, windowSeconds: 3600 });
    if (!rate.configured) return serviceErrorResponse({ error: "Secure support controls are unavailable." }, 503);
    if (!rate.allowed) return serviceErrorResponse({ error: "Too many submissions. Check the saved report or try again later." }, 429);
    const result = await auth.service!.report(input.data, AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]));
    return serviceErrorResponse({ result }, result.replayed ? 200 : 201);
  } catch (error) { return serviceErrorFailure(error); }
}
