import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { serviceErrorPrivateResponse, serviceErrorResponse } from "@/lib/materials/service-error-http";
import { repairWordingHttpSchema, repairWordingIdentitySchema } from "@/lib/materials/service-repair-wording";
import { createServiceRepairWordingServer, ServiceRepairWordingError } from "@/lib/documents/service-repair-wording-server";

type Route = { params: Promise<{ id: string; materialLineId: string }> };
const pathSchema = z.object({ id: z.uuid(), materialLineId: z.uuid() }).strict();
async function input(request: Request): Promise<unknown> {
  if (!request.body || request.signal.aborted || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0, bytes: Buffer | undefined;
  let interrupt: () => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => { interrupt = () => { void reader.cancel().catch(() => undefined); reject(new Error("INTERRUPTED")); }; });
  const timer = setTimeout(interrupt, 5000); request.signal.addEventListener("abort", interrupt, { once: true }); if (request.signal.aborted) interrupt();
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), stopped]); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > 1024 * 1024) { chunk.value.fill(0); void reader.cancel().catch(() => undefined); return null; } chunks.push(chunk.value);
    }
    bytes = Buffer.concat(chunks); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", interrupt); chunks.forEach(chunk => chunk.fill(0)); bytes?.fill(0); reader.releaseLock(); }
}
function failed(error: unknown) {
  if (error instanceof ServiceRepairWordingError && error.code === "TOO_LARGE") return serviceErrorResponse({ code: "REVIEW_TOO_LARGE",
    error: "The complete wording review exceeds its storage limit. Nothing was saved by this action. Review the source with an operator; do not omit affected statements." }, 422);
  const changed = error instanceof ServiceRepairWordingError && error.code === "CHANGED";
  return serviceErrorResponse({ code: changed ? "REPAIR_CHANGED" : "RESULT_UNCONFIRMED", error: changed
    ? "The saved repair or its evidence changed. Reload before reviewing wording."
    : "The wording review could not be confirmed. Check this exact saved request before trying again." }, changed ? 409 : 503);
}
export async function GET(request: Request, route: Route) {
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const path = pathSchema.safeParse(await route.params), query = new URL(request.url).searchParams;
    if (!path.success || query.getAll("versionId").length !== 1 || [...query.keys()].some(key => key !== "versionId")) return serviceErrorResponse({ error: "Repair not found." }, 404);
    const identity = repairWordingIdentitySchema.safeParse({ caseId: path.data.id, materialLineId: path.data.materialLineId, versionId: query.get("versionId") });
    if (!identity.success) return serviceErrorResponse({ error: "Repair not found." }, 404);
    return serviceErrorResponse({ view: await createServiceRepairWordingServer(auth.admin, auth.user.id).read(identity.data, request.signal) });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request, route: Route) {
  if (!isSameOriginRequest(request)) return serviceErrorResponse({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin(); if (!auth.ok) return serviceErrorPrivateResponse(auth.response);
    const path = pathSchema.safeParse(await route.params), parsed = repairWordingHttpSchema.safeParse(await input(request));
    if (!path.success || !parsed.success || parsed.data.request.expected.caseId !== path.data.id || parsed.data.request.expected.materialLineId !== path.data.materialLineId) {
      return serviceErrorResponse({ error: "Reload the exact saved wording before reviewing it." }, 400);
    }
    return serviceErrorResponse({ result: await createServiceRepairWordingServer(auth.admin, auth.user.id)
      .act(parsed.data.request, parsed.data.operation === "CHECK", request.signal) });
  } catch (error) { return failed(error); }
}
