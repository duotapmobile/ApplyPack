import type { JobEnumerationResult, JobSourceAdapter, SourceHealth } from "./types";
import type { RawJobPosting, SourceDefinition } from "../types";

export class OfficialLinkAdapter implements JobSourceAdapter {
  constructor(readonly source: SourceDefinition) {}

  async healthCheck(): Promise<SourceHealth> {
    return {
      sourceId: this.source.id,
      status: this.source.officialUrl ? "link_only" : "misconfigured",
      checkedAt: new Date().toISOString(),
      httpStatus: null,
      message: this.source.officialUrl
        ? "Official career link is registered; no supported structured endpoint is configured."
        : "Official career source remains pending verification.",
    };
  }

  async fetchJobs(): Promise<RawJobPosting[]> {
    return [];
  }

  async enumerateJobs(): Promise<JobEnumerationResult> {
    return {
      sourceId: this.source.id,
      adapterVersion: "official-link-v1",
      completion: "failed",
      responseClassification: "unsupported",
      checkpoint: { cursor: null, stopReason: "STRUCTURED_ENDPOINT_NOT_CONFIGURED" },
      counts: { pagesRequested: 0, pagesCompleted: 0, received: 0, mapped: 0, rejected: 0 },
      jobs: [],
      errors: [{
        code: "structured_endpoint_not_configured",
        category: "configuration",
        message: "Official career link is registered, but structured automated collection is not configured.",
        retryable: false,
        httpStatus: null,
        retryAfterSeconds: null,
      }],
    };
  }
}
