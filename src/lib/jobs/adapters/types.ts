import type { RawJobPosting, SourceDefinition } from "../types";

export type SourceHealth = {
  sourceId: string;
  status: "healthy" | "link_only" | "unavailable" | "rate_limited" | "misconfigured";
  checkedAt: string;
  httpStatus: number | null;
  message: string;
};

export type EnumerationCompletion = "complete" | "partial" | "failed";

export type EnumerationError = {
  code: string;
  category: "authorization" | "configuration" | "network" | "rate_limit" | "http" | "payload";
  message: string;
  retryable: boolean;
  httpStatus: number | null;
  retryAfterSeconds: number | null;
};

export type JobEnumerationResult = {
  sourceId: string;
  adapterVersion: string;
  completion: EnumerationCompletion;
  responseClassification: "success" | "bounded_partial" | "rate_limited" | "upstream_error" | "invalid_payload" | "unsupported";
  checkpoint: { cursor: string | null; stopReason: string };
  counts: {
    pagesRequested: number;
    pagesCompleted: number;
    received: number;
    mapped: number;
    rejected: number;
  };
  jobs: RawJobPosting[];
  errors: EnumerationError[];
};

export type RuntimeSourceAuthorization = {
  id: string;
  sourceId: string;
  state: "AUTHORIZED_AUTOMATED" | "AUTHORIZED_MANUAL_ONLY" | "UNVERIFIED_DISABLED" | "BLOCKED";
  accessMethod: string;
  authorizationVersion: string;
  allowedActions: readonly string[];
  allowedHosts: readonly string[];
};

export type JobEnumerationOptions = {
  resultBound?: number;
  pageBound?: number;
  requestBound?: number;
  maximumResponseBytes?: number;
  requestTimeoutMs?: number;
  deadlineAtMs?: number;
  checkpoint?: string | null;
  beforeRequest?: () => Promise<void>;
};

export interface JobSourceAdapter {
  readonly source: SourceDefinition;
  healthCheck(): Promise<SourceHealth>;
  enumerateJobs(options?: JobEnumerationOptions): Promise<JobEnumerationResult>;
  /** @deprecated Use enumerateJobs so completeness and error evidence are preserved. */
  fetchJobs(): Promise<RawJobPosting[]>;
}
