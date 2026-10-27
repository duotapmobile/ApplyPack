import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createOwnerRepairFollowups } from "@/lib/materials/service-repair-followup-server";
import { repairCaseStateRequestSchema } from "@/lib/materials/service-repair-followup";
import { readServiceErrorInput, serviceErrorFailure, serviceErrorPrivateResponse, serviceErrorResponse } from "@/lib/materials/service-error-http";

type Route = { params: Promise<{ id: string }> };
const identity = z.object({ id: z.uuid() }).strict();

export async function GET(request: Request, route: Route) {
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const target = identity.safeParse(await route.params);
    if (!target.success) return serviceErrorResponse({ error: "Repair case not found." }, 404);
    const query = new URL(request.url).searchParams, keys = [...query.keys()];
    if (keys.length > 1 || keys.some((key) => key !== "requestId" && key !== "feedbackId"))
      return serviceErrorResponse({ error: "Select one saved decision or feedback item." }, 400);
    const selected = keys.length ? z.uuid().safeParse(query.get(keys[0])) : null;
    if (selected && !selected.success) return serviceErrorResponse({ error: "The saved item ID is invalid." }, 400);
    const service = createOwnerRepairFollowups(auth.admin, auth.user.id);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    if (keys[0] === "requestId" && selected?.success)
      return serviceErrorResponse({ receipt: await service.receipt(target.data.id, selected.data, signal) });
    if (keys[0] === "feedbackId" && selected?.success)
      return serviceErrorResponse(await service.feedback(target.data.id, selected.data, signal));
    return serviceErrorResponse(await service.review(target.data.id, signal));
  } catch (error) { return serviceErrorFailure(error); }
}

export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const target = identity.safeParse(await route.params), input = repairCaseStateRequestSchema.safeParse(await readServiceErrorInput(request));
    if (!target.success || !input.success || input.data.caseId !== target.data.id || new URL(request.url).search)
      return serviceErrorResponse({ error: "Reload the current case review before recording a decision." }, 400);
    const service = createOwnerRepairFollowups(auth.admin, auth.user.id);
    const result = await service.set(input.data, AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]));
    return serviceErrorResponse({ result }, result.replayed ? 200 : 201);
  } catch (error) { return serviceErrorFailure(error); }
}
