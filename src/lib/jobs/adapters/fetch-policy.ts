import { isIP } from "node:net";

const lastRequestByOrigin = new Map<string, number>();

type FetchPolicyOptions = { timeoutMs?: number };

export async function fetchOfficialJson(url: string, allowedHosts: readonly string[], options: FetchPolicyOptions = {}): Promise<Response> {
  return fetchOfficial(url, allowedHosts, "application/json", options);
}

export async function fetchOfficialText(url: string, allowedHosts: readonly string[], options: FetchPolicyOptions = {}): Promise<Response> {
  return fetchOfficial(url, allowedHosts, "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8", options);
}

async function fetchOfficial(url: string, allowedHosts: readonly string[], accept: string, options: FetchPolicyOptions): Promise<Response> {
  const parsed = new URL(url);
  const normalizedAllowedHosts = allowedHosts.map((host) => host.toLowerCase());
  const hostname = parsed.hostname.toLowerCase();
  const ipCandidate = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
    || isIP(ipCandidate) !== 0
    || hostname === "localhost"
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || !normalizedAllowedHosts.includes(hostname)
  ) {
    throw new Error("Source URL is outside the adapter allowlist.");
  }
  const minimumInterval = boundedNumber(process.env.APP_JOB_SOURCE_MIN_INTERVAL_MS, 1_500, 250, 60_000);
  const timeout = boundedNumber(options.timeoutMs ?? process.env.APP_JOB_SOURCE_TIMEOUT_MS, 10_000, 1_000, 120_000);
  const previous = lastRequestByOrigin.get(parsed.origin) || 0;
  const wait = Math.max(0, minimumInterval - (Date.now() - previous));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestByOrigin.set(parsed.origin, Date.now());
  return fetch(parsed, {
    method: "GET",
    headers: {
      accept,
      "user-agent": process.env.APP_JOB_SOURCE_USER_AGENT || "ApplyPackSourceMonitor/1.0 (+https://applypack.work/contact)",
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  });
}

export async function readBoundedJson(response: Response, maximumBytes = 5 * 1024 * 1024): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, maximumBytes));
}

export async function readBoundedText(response: Response, maximumBytes = 5 * 1024 * 1024): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new Error("Source response exceeds the configured size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel("Source response exceeded the configured size limit.").catch(() => undefined);
      throw new Error("Source response exceeds the configured size limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function boundedNumber(value: string | number | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
