const lastRequestByOrigin = new Map<string, number>();

export async function fetchOfficialJson(url: string, allowedHosts: readonly string[]): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname)) {
    throw new Error("Source URL is outside the adapter allowlist.");
  }
  const minimumInterval = boundedNumber(process.env.APP_JOB_SOURCE_MIN_INTERVAL_MS, 1_500, 250, 60_000);
  const timeout = boundedNumber(process.env.APP_JOB_SOURCE_TIMEOUT_MS, 10_000, 1_000, 30_000);
  const previous = lastRequestByOrigin.get(parsed.origin) || 0;
  const wait = Math.max(0, minimumInterval - (Date.now() - previous));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestByOrigin.set(parsed.origin, Date.now());
  return fetch(parsed, {
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": process.env.APP_JOB_SOURCE_USER_AGENT || "ApplyPackSourceMonitor/1.0 (+https://applypack.work/contact)",
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  });
}

export async function readBoundedJson(response: Response, maximumBytes = 5 * 1024 * 1024): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new Error("Source response exceeds the configured size limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error("Source response exceeds the configured size limit.");
  return JSON.parse(new TextDecoder().decode(bytes));
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
