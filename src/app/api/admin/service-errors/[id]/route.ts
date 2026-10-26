import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createOwnerServiceErrors } from "@/lib/materials/service-error-server";
import { createServiceErrorEvidenceReader } from "@/lib/materials/service-error-evidence";
import { serviceErrorDecisionSchema } from "@/lib/materials/service-error-contract";
import { readServiceErrorInput, serviceErrorPrivateResponse, serviceErrorResponse, serviceErrorFailure } from "@/lib/materials/service-error-http";
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, route: Route) {
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const caseId = z.uuid().safeParse((await route.params).id); if (!caseId.success) return serviceErrorResponse({ error: "Report not found." }, 404);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    const inspection = await createOwnerServiceErrors(auth.admin, auth.user.id).inspect(caseId.data, signal);
    const selected = [...inspection.report.members, ...inspection.decisions.flatMap((decision) => decision.affected)]
      .filter((member, index, all) => all.findIndex((value) => value.fileVersionId === member.fileVersionId && value.releaseId === member.releaseId) === index);
    if (selected.length > 30) return serviceErrorResponse({ error: "This report needs a bounded evidence review." }, 409);
    const read = createServiceErrorEvidenceReader(auth.admin, auth.user.id), files = [];
    for (const member of selected) files.push(await read(inspection.report.customerId, member, signal));
    return serviceErrorResponse({ inspection, files });
  } catch (error) { return serviceErrorFailure(error); }
}
export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const caseId = z.uuid().safeParse((await route.params).id), input = serviceErrorDecisionSchema.safeParse(await readServiceErrorInput(request));
    if (!caseId.success || !input.success || input.data.caseId !== caseId.data) return serviceErrorResponse({ error: "Review the evidence and complete the decision." }, 400);
    const result = await createOwnerServiceErrors(auth.admin, auth.user.id).decide(input.data, AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]));
    return serviceErrorResponse({ result });
  } catch (error) { return serviceErrorFailure(error); }
}
