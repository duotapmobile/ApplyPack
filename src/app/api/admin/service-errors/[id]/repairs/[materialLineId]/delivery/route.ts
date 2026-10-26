import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createServiceRepairDelivery, ServiceRepairDeliveryError } from "@/lib/materials/service-repair-delivery-server";
import { repairDeliveryRequestSchema } from "@/lib/materials/service-repair-delivery-client";
import { readServiceErrorInput, serviceErrorPrivateResponse, serviceErrorResponse } from "@/lib/materials/service-error-http";

type Route = { params: Promise<{ id: string; materialLineId: string }> };
const pathSchema = z.object({ id: z.uuid(), materialLineId: z.uuid() }).strict();
function failure(error: unknown) {
  const changed = error instanceof ServiceRepairDeliveryError && ["CHANGED", "NOT_READY"].includes(error.code);
  return serviceErrorResponse({ error: changed ? "These repair files changed or are not ready. Reload them and review the current version."
    : "The result could not be confirmed. Check the saved result before retrying.", code: changed ? "REPAIR_CHANGED" : "RESULT_UNCONFIRMED" }, changed ? 409 : 503);
}
export async function GET(request: Request, route: Route) {
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const path = pathSchema.safeParse(await route.params); if (!path.success) return serviceErrorResponse({ error: "Repair not found." }, 404);
    const identity = { caseId: path.data.id, materialLineId: path.data.materialLineId }, query = new URL(request.url).searchParams;
    const service = createServiceRepairDelivery(auth.admin, auth.user.id);
    if ([...query.keys()].length) {
      const input = z.object({ versionId: z.uuid(), previewFileId: z.uuid() }).strict().safeParse(Object.fromEntries(query));
      if (!input.success || [...query.keys()].length !== 2) return serviceErrorResponse({ error: "Invalid preview." }, 400);
      const url = await service.preview({ ...identity, versionId: input.data.versionId, fileVersionId: input.data.previewFileId }, request.signal);
      return serviceErrorPrivateResponse(NextResponse.redirect(url, 303));
    }
    return serviceErrorResponse({ summary: await service.inspect(identity, request.signal) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const path = pathSchema.safeParse(await route.params), input = repairDeliveryRequestSchema.safeParse(await readServiceErrorInput(request));
    if (!path.success || !input.success || input.data.request.expected.caseId !== path.data.id
      || input.data.request.expected.materialLineId !== path.data.materialLineId) return serviceErrorResponse({ error: "Reload the exact repair files before continuing." }, 400);
    const result = await createServiceRepairDelivery(auth.admin, auth.user.id).act(input.data.request, input.data.operation === "CHECK", request.signal);
    return serviceErrorResponse({ result });
  } catch (error) { return failure(error); }
}
