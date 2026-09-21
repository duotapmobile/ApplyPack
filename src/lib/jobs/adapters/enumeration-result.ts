import type { SourceDefinition } from "../types";
import type { EnumerationError, JobEnumerationOptions, JobEnumerationResult } from "./types";

export function adapterAllowedHosts(source: SourceDefinition, requiredHosts: readonly string[]): readonly string[] {
  const normalized = requiredHosts.map((host) => host.toLowerCase());
  if (!source.authorizationAllowedHosts) return normalized;
  const authorized = source.authorizationAllowedHosts.map((host) => host.toLowerCase());
  if (normalized.some((host) => !authorized.includes(host))) {
    throw new Error("The current source authorization does not allow the adapter endpoint host.");
  }
  return normalized;
}

export function sourceResultBound(value: string | number | undefined = process.env.APP_JOB_SOURCE_MAX_POSTINGS, fallback = 250): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : fallback;
}

export function sourceRequestBound(value: number | undefined, fallback = 20): number {
  return Number.isInteger(value) ? Math.min(20, Math.max(1, value!)) : fallback;
}

export function sourceRequestTimeout(options: JobEnumerationOptions): number | undefined {
  const configured = options.requestTimeoutMs;
  if (options.deadlineAtMs === undefined) return configured;
  const remaining = Math.floor(options.deadlineAtMs - Date.now());
  if (remaining < 1) throw new Error("Source enumeration exceeded its configured duration limit.");
  return configured === undefined ? remaining : Math.min(configured, remaining);
}

export function enumerationFailure(input: {
  sourceId: string;
  adapterVersion: string;
  message: string;
  code: string;
  category: EnumerationError["category"];
  httpStatus?: number | null;
  retryAfterSeconds?: number | null;
  pagesRequested?: number;
  pagesCompleted?: number;
  received?: number;
  jobs?: JobEnumerationResult["jobs"];
}): JobEnumerationResult {
  const httpStatus = input.httpStatus ?? null;
  const rateLimited = httpStatus === 429 || input.category === "rate_limit";
  const jobs = input.jobs || [];
  return {
    sourceId: input.sourceId,
    adapterVersion: input.adapterVersion,
    completion: "failed",
    responseClassification: rateLimited ? "rate_limited" : input.category === "payload" ? "invalid_payload" : "upstream_error",
    checkpoint: { cursor: null, stopReason: input.code },
    counts: {
      pagesRequested: input.pagesRequested || 0,
      pagesCompleted: input.pagesCompleted || 0,
      received: input.received || 0,
      mapped: jobs.length,
      rejected: Math.max(0, (input.received || 0) - jobs.length),
    },
    jobs,
    errors: [{
      code: input.code,
      category: input.category,
      message: input.message,
      retryable: rateLimited || input.category === "network" || (httpStatus !== null && httpStatus >= 500),
      httpStatus,
      retryAfterSeconds: input.retryAfterSeconds ?? null,
    }],
  };
}

export function adapterErrorCategory(error: unknown): EnumerationError["category"] {
  if (error instanceof SyntaxError) return "payload";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("authorization") || message.includes("documentarily authorized")) return "authorization";
  if (
    message.includes("configured")
    || message.includes("allowlist")
    || message.includes("valid company identifier")
    || message.includes("checkpoint is invalid")
    || message.includes("result bound is required")
  ) return "configuration";
  if (
    message.includes("payload")
    || message.includes("size limit")
    || message.includes("forbidden declaration")
    || message.includes("invalid json")
  ) return "payload";
  return "network";
}

export function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1_000)) : null;
}

export function legacyJobs(result: JobEnumerationResult) {
  if (result.completion === "failed") {
    throw new Error(result.errors[0]?.message || "Source enumeration failed.");
  }
  if (result.completion === "partial") {
    throw new Error("Source enumeration stopped at its configured result bound; no jobs were changed.");
  }
  return result.jobs;
}
