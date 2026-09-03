import type { JobSourceAdapter, SourceHealth } from "./types";
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
}
