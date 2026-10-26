import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createServiceRepairStore } from "@/lib/materials/service-repair-store";
import { openServiceRepair, serviceRepairOpenRequestSchema, validateServiceRepairInspection,
  serviceRepairVersionSchema, type ServiceRepairVersion } from "@/lib/materials/service-repair-workflow";
import { ServiceRepairContractError } from "@/lib/materials/service-repair-contract";
import { serviceRepairReceiptSchema, serviceRepairSummarySchema } from "@/lib/materials/service-repair-client";
import { readServiceErrorInput, serviceErrorPrivateResponse, serviceErrorResponse } from "@/lib/materials/service-error-http";

type Route = { params: Promise<{ id: string; materialLineId: string }> };
const identitySchema = z.object({ id: z.uuid(), materialLineId: z.uuid() }).strict();
function receipt(value: ServiceRepairVersion) {
  return serviceRepairReceiptSchema.parse({ id: value.id, requestId: value.request_id, caseId: value.case_id,
    materialLineId: value.material_line_id, supersedesId: value.supersedes_id, acceptedScopeSha256: value.accepted_scope_sha256,
    contextSha256: value.context_sha256, version: value.version });
}
function failure(error: unknown) {
  const changed = error instanceof ServiceRepairContractError && ["CONTEXT_CHANGED", "REQUEST_CONFLICT", "SCOPE_CHANGED"].includes(error.code);
  return serviceErrorResponse({ error: changed ? "The accepted repair changed. Reload its saved status before continuing."
    : "The repair result could not be confirmed. Check its saved status before trying again.",
  code: changed ? "REPAIR_CHANGED" : "RESULT_UNCONFIRMED" }, changed ? 409 : 503);
}
export async function GET(request: Request, route: Route) {
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const identity = identitySchema.safeParse(await route.params);
    if (!identity.success) return serviceErrorResponse({ error: "Repair not found." }, 404);
    const { id: caseId, materialLineId } = identity.data;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]), store = createServiceRepairStore(auth.admin);
    if (request.signal.aborted) return failure(null);
    const query = new URL(request.url).searchParams;
    if (query.has("requestId")) {
      const requestId = z.uuid().safeParse(query.get("requestId"));
      if (!requestId.success || query.getAll("requestId").length !== 1) return serviceErrorResponse({ error: "Invalid saved request." }, 400);
      if (await store.requireReviewer(auth.user.id, signal) !== true) return failure(null);
      const raw = await store.readVersion(requestId.data, auth.user.id, signal);
      if (raw === null) return serviceErrorResponse({ receipt: null });
      const version = serviceRepairVersionSchema.parse(raw);
      if (version.request_id !== requestId.data || version.case_id !== caseId || version.material_line_id !== materialLineId
        || version.created_by !== auth.user.id) return serviceErrorResponse({ error: "Saved request not found." }, 404);
      return serviceErrorResponse({ receipt: receipt(version) });
    }
    const inspection = validateServiceRepairInspection(await store.inspect(caseId, materialLineId, auth.user.id, signal), { caseId, materialLineId });
    const version = inspection.version;
    const summary = serviceRepairSummarySchema.parse({ caseId, materialLineId, acceptedScopeSha256: inspection.scope.acceptedScopeSha256,
      contextSha256: inspection.contextSha256, originals: inspection.originals.map(({ artifactId, fileVersionId, artifactType, deliveredAt }) =>
        ({ artifactId, fileVersionId, artifactType, deliveredAt })), current: version ? { ...receipt(version), sourceSaved: Boolean(version.encrypted_payload_id),
        invalidatedAt: version.invalidated_at, approvedAt: version.approved_at, releaseId: version.release_id } : null });
    return serviceErrorResponse({ summary });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const identity = identitySchema.safeParse(await route.params), input = serviceRepairOpenRequestSchema.safeParse(await readServiceErrorInput(request));
    if (!identity.success || !input.success || input.data.caseId !== identity.data.id || input.data.materialLineId !== identity.data.materialLineId) {
      return serviceErrorResponse({ error: "Reload the accepted repair before opening a version." }, 400);
    }
    const result = await openServiceRepair(createServiceRepairStore(auth.admin), auth.user.id, input.data, { signal: request.signal });
    return serviceErrorResponse({ receipt: receipt(result.version), replayed: result.replayed, renderingAuthorized: false, deliveryAuthorized: false });
  } catch (error) { return failure(error); }
}
