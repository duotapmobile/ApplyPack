import { authorizeIndependentMonitor, MONITOR_HEADERS } from "@/lib/operations/independent-monitor";
import { readIndependentMonitorSnapshot } from "@/lib/operations/independent-monitor-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { configuration, nonce } = authorizeIndependentMonitor(request);
    return Response.json(await readIndependentMonitorSnapshot(configuration, nonce, request.signal), { headers: MONITOR_HEADERS });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "MONITOR_UNAUTHORIZED" ? 401 : code === "MONITOR_INVALID_REQUEST" ? 400 : 503;
    return Response.json({ error: "Operations monitor unavailable." }, { status, headers: MONITOR_HEADERS });
  }
}
