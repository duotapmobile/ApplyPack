import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { readServiceErrorInput, serviceErrorPrivateResponse, serviceErrorResponse } from "@/lib/materials/service-error-http";
import { createServiceRepairAuthoringServer, serviceRepairAuthoringIdentitySchema, serviceRepairSaveSourceSchema,
  ServiceRepairAuthoringServerError } from "@/lib/documents/service-repair-authoring-server";

type Route = { params: Promise<{ id: string; materialLineId: string }> };
const pathSchema = z.object({ id: z.uuid(), materialLineId: z.uuid() }).strict();
const actionSchema = z.object({ action: z.enum(["SAVE", "CHECK"]), request: serviceRepairSaveSourceSchema }).strict();
function failed(error: unknown) {
  const invalid = error instanceof ServiceRepairAuthoringServerError && error.code === "WORDING_INVALID";
  return serviceErrorResponse({ code: invalid ? "WORDING_INVALID" : "RESULT_UNCONFIRMED", error: invalid
    ? "The corrected wording did not pass its confirmed-evidence checks. This action did not write corrected content. Review the current repair and its supporting facts before continuing."
    : "The saved content could not be confirmed. Check this exact request before trying again." }, invalid ? 422 : 503);
}
export async function GET(request: Request, route: Route) {
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const path = pathSchema.safeParse(await route.params), query = new URL(request.url).searchParams;
    if (!path.success || query.getAll("versionId").length !== 1 || [...query.keys()].some(key => key !== "versionId")) {
      return serviceErrorResponse({ error: "Repair not found." }, 404);
    }
    const identity = serviceRepairAuthoringIdentitySchema.safeParse({ caseId: path.data.id, materialLineId: path.data.materialLineId, versionId: query.get("versionId") });
    if (!identity.success) return serviceErrorResponse({ error: "Repair not found." }, 404);
    return serviceErrorResponse({ view: await createServiceRepairAuthoringServer(auth.admin, auth.user.id).read(identity.data, request.signal) });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const path = pathSchema.safeParse(await route.params), input = actionSchema.safeParse(await readServiceErrorInput(request));
    if (!path.success || !input.success || input.data.request.caseId !== path.data.id || input.data.request.materialLineId !== path.data.materialLineId) {
      return serviceErrorResponse({ error: "Reload the exact accepted repair before correcting content." }, 400);
    }
    const server = createServiceRepairAuthoringServer(auth.admin, auth.user.id);
    const receipt = input.data.action === "CHECK" ? await server.check(input.data.request, request.signal) : await server.save(input.data.request, request.signal);
    return serviceErrorResponse({ receipt });
  } catch (error) { return failed(error); }
}
