import "server-only";
import { NextResponse } from "next/server";
import { ServiceErrorContractError } from "./service-error-contract";

export function serviceErrorPrivateResponse(result: Response) {
  result.headers.set("Cache-Control", "no-store, private"); result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Content-Type-Options", "nosniff"); return result;
}
export function serviceErrorResponse(body: unknown, status = 200) {
  return serviceErrorPrivateResponse(NextResponse.json(body, { status }));
}
/** Reads a bounded private JSON body, including streamed/chunked requests. */
export async function readServiceErrorInput(request: Request): Promise<unknown> {
  if (!request.body || request.signal.aborted || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0, bytes: Buffer | undefined;
  let interrupt: () => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => { interrupt = () => { void reader.cancel().catch(() => undefined); reject(new Error("BODY_INTERRUPTED")); }; });
  const timer = setTimeout(interrupt, 5000); request.signal.addEventListener("abort", interrupt, { once: true });
  if (request.signal.aborted) interrupt();
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), stopped]); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 96 * 1024) { chunk.value.fill(0); void reader.cancel().catch(() => undefined); return null; }
      chunks.push(chunk.value);
    }
    bytes = Buffer.concat(chunks); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", interrupt); chunks.forEach((chunk) => chunk.fill(0)); bytes?.fill(0); reader.releaseLock(); }
}
export function serviceErrorFailure(error: unknown) {
  const code = error instanceof ServiceErrorContractError ? error.code : "UNCONFIRMED";
  const fixed: Record<string, [number, string]> = {
    REPORT_WINDOW_CLOSED: [409, "The reporting deadline for this delivery has passed. Contact support for other help."],
    HISTORICAL_FLOW_REQUIRED: [409, "This delivery uses its original support terms. Use the support action beside the delivery."],
    CASE_CHANGED: [409, "This report changed while it was open. Reload it before recording a decision."],
    REPORT_IDENTITY_CONFLICT: [409, "This request ID already belongs to different report details. Check the saved report first."],
    DECISION_IDENTITY_CONFLICT: [409, "This decision ID already belongs to different details. Check the saved decision first."],
  };
  const known = fixed[code];
  return known ? serviceErrorResponse({ error: known[1], code }, known[0])
    : serviceErrorResponse({ error: "The result could not be confirmed. Keep this request open and check its saved status before trying again.", code: "RESULT_UNCONFIRMED" }, 503);
}
