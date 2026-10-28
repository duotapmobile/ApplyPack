import { z } from "zod";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { repairFeedbackRequestSchema } from "@/lib/materials/service-repair-followup";
import { createCustomerRepairFollowups } from "@/lib/materials/service-repair-followup-server";
import { readServiceErrorInput, serviceErrorResponse, serviceErrorFailure } from "@/lib/materials/service-error-http";

type Route = { params: Promise<{ id: string }> };
async function authenticate(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: serviceErrorResponse({ error: "Secure support is unavailable." }, 503) };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: serviceErrorResponse({ error: "Sign in to view your repaired delivery." }, 401) };
  const admin = createSupabaseAdminClient({ signal: request.signal });
  if (!admin) return { error: serviceErrorResponse({ error: "Secure support is unavailable." }, 503) };
  return { customerId: data.user.id, service: createCustomerRepairFollowups(admin, data.user.id) };
}
export async function GET(request: Request, route: Route) {
  try {
    const lineId = z.uuid().safeParse((await route.params).id);
    if (!lineId.success) return serviceErrorResponse({ error: "Delivery not found." }, 404);
    const auth = await authenticate(request); if (auth.error) return auth.error;
    const requestId = new URL(request.url).searchParams.get("requestId"), signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    if (requestId !== null) {
      const parsed = z.uuid().safeParse(requestId); if (!parsed.success) return serviceErrorResponse({ error: "Request ID is invalid." }, 400);
      return serviceErrorResponse({ receipt: await auth.service!.receipt(lineId.data, parsed.data, signal) });
    }
    return serviceErrorResponse(await auth.service!.context(lineId.data, signal));
  } catch (error) { return serviceErrorFailure(error); }
}
export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This request was rejected." }, 403);
  try {
    const lineId = z.uuid().safeParse((await route.params).id), auth = await authenticate(request); if (auth.error) return auth.error;
    const input = repairFeedbackRequestSchema.safeParse(await readServiceErrorInput(request));
    if (!lineId.success || !input.success || input.data.materialLineId !== lineId.data)
      return serviceErrorResponse({ error: "Select the repaired documents and describe the remaining factual issue." }, 400);
    const rate = await consumeRateLimit({ request, scope: "material_service_repair_feedback", identity: auth.customerId!, limit: 10, windowSeconds: 3600 });
    if (!rate.configured) return serviceErrorResponse({ error: "Secure support controls are unavailable." }, 503);
    if (!rate.allowed) return serviceErrorResponse({ error: "Too many submissions. Check the saved feedback or try again later." }, 429);
    const result = await auth.service!.report(input.data, AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]));
    return serviceErrorResponse({ result }, result.replayed ? 200 : 201);
  } catch (error) { return serviceErrorFailure(error); }
}
