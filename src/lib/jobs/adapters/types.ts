import type { RawJobPosting, SourceDefinition } from "../types";

export type SourceHealth = {
  sourceId: string;
  status: "healthy" | "link_only" | "unavailable" | "rate_limited" | "misconfigured";
  checkedAt: string;
  httpStatus: number | null;
  message: string;
};

export interface JobSourceAdapter {
  readonly source: SourceDefinition;
  healthCheck(): Promise<SourceHealth>;
  fetchJobs(): Promise<RawJobPosting[]>;
}
