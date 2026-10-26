import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { readServiceErrorInput, serviceErrorPrivateResponse, serviceErrorResponse } from "@/lib/materials/service-error-http";
import { repairFileHttpSchema, repairFileIdentitySchema } from "@/lib/materials/service-repair-file-client";
import { createServiceRepairFiles } from "@/lib/documents/service-repair-file-server";

type Route = { params: Promise<{ id: string; materialLineId: string }> };
const pathSchema = z.object({ id: z.uuid(), materialLineId: z.uuid() }).strict();
const failed = () => serviceErrorResponse({ error: "The repaired files could not be confirmed. Keep this request open and check its saved status before continuing.", code: "RESULT_UNCONFIRMED" }, 503);
function server(auth: Extract<Awaited<ReturnType<typeof requireAdmin>>, { ok: true }>) {
  return createServiceRepairFiles(auth.admin, auth.user.id, { uploadClientFactory: signal => createSupabaseAdminClient({ signal }) });
}
export async function GET(request: Request, route: Route) {
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const path = pathSchema.safeParse(await route.params), query = new URL(request.url).searchParams;
    if (!path.success || query.getAll("versionId").length !== 1 || [...query.keys()].some(key => key !== "versionId")) return serviceErrorResponse({ error: "Repair not found." }, 404);
    const identity = repairFileIdentitySchema.safeParse({ caseId: path.data.id, materialLineId: path.data.materialLineId, versionId: query.get("versionId") });
    if (!identity.success) return serviceErrorResponse({ error: "Repair not found." }, 404);
    return serviceErrorResponse({ view: await server(auth).inspect(identity.data, request.signal) });
  } catch { return failed(); }
}
export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const path = pathSchema.safeParse(await route.params), input = repairFileHttpSchema.safeParse(await readServiceErrorInput(request));
    if (!path.success || !input.success || input.data.request.expected.caseId !== path.data.id || input.data.request.expected.materialLineId !== path.data.materialLineId) {
      return serviceErrorResponse({ error: "Reload the exact accepted repair before preparing files." }, 400);
    }
    const adapter = server(auth), result = input.data.operation === "CHECK" ? await adapter.check(input.data.request, request.signal) : await adapter.render(input.data.request, request.signal);
    return serviceErrorResponse({ result });
  } catch { return failed(); }
}
