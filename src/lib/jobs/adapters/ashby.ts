import { captureRawSourceEvidence } from "../raw-source-evidence";
import { fetchOfficialJson, readBoundedJson } from "./fetch-policy";
import { adapterAllowedHosts, adapterErrorCategory, enumerationFailure, legacyJobs, retryAfterSeconds, sourceRequestTimeout, sourceResultBound } from "./enumeration-result";
import type { JobEnumerationOptions, JobEnumerationResult, JobSourceAdapter, SourceHealth } from "./types";
import type { RawJobPosting, SourceDefinition } from "../types";
import { sourceUrlMatchesDefinition } from "../source-registry";

type AshbyJob = {
  title?: unknown; location?: unknown; department?: unknown; team?: unknown;
  descriptionPlain?: unknown; jobUrl?: unknown; applyUrl?: unknown; publishedAt?: unknown;
  employmentType?: unknown; isListed?: unknown;
};

export class AshbyAdapter implements JobSourceAdapter {
  static readonly version = "ashby-v3";

  constructor(readonly source: SourceDefinition) {
    if (!source.adapterKey) throw new Error(`Ashby source ${source.id} has no job-board name.`);
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchOfficialJson(this.endpoint(), adapterAllowedHosts(this.source, ["api.ashbyhq.com"]));
      if (response.status === 429) return { sourceId: this.source.id, status: "rate_limited", checkedAt, httpStatus: 429, message: "Ashby requested a slower request rate." };
      if (!response.ok) return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: response.status, message: "Ashby did not return a successful response." };
      return { sourceId: this.source.id, status: "healthy", checkedAt, httpStatus: response.status, message: "Published Ashby Job Postings API is available." };
    } catch (error) {
      return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: null, message: error instanceof Error ? error.message : "Source health check failed." };
    }
  }

  async enumerateJobs(options: JobEnumerationOptions = {}): Promise<JobEnumerationResult> {
    try {
      await options.beforeRequest?.();
      const response = await fetchOfficialJson(this.endpoint(), adapterAllowedHosts(this.source, ["api.ashbyhq.com"]), { timeoutMs: sourceRequestTimeout(options) });
      if (response.status === 429) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: AshbyAdapter.version, message: "Ashby source is rate limited; no jobs were changed.",
        code: "ashby_rate_limited", category: "rate_limit", httpStatus: 429, retryAfterSeconds: retryAfterSeconds(response), pagesRequested: 1,
      });
      if (!response.ok) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: AshbyAdapter.version,
        message: `Ashby source returned HTTP ${response.status}; no jobs were changed.`,
        code: "ashby_http_error", category: "http", httpStatus: response.status, pagesRequested: 1,
      });
      const payload = await readBoundedJson(response, options.maximumResponseBytes) as { jobs?: unknown };
      if (!Array.isArray(payload.jobs)) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: AshbyAdapter.version,
        message: "Ashby source returned an unexpected payload.", code: "ashby_invalid_payload",
        category: "payload", httpStatus: response.status, pagesRequested: 1, pagesCompleted: 1,
      });
      const listed = payload.jobs.filter((job) => (job as AshbyJob).isListed !== false);
      const maximum = sourceResultBound(options.resultBound);
      const jobs = listed.slice(0, maximum).map((job) => this.mapPosting(job as AshbyJob))
        .filter((job): job is RawJobPosting => Boolean(job));
      const complete = listed.length <= maximum;
      return {
        sourceId: this.source.id, adapterVersion: AshbyAdapter.version,
        completion: complete ? "complete" : "partial",
        responseClassification: complete ? "success" : "bounded_partial",
        checkpoint: { cursor: null, stopReason: complete ? "SOURCE_EXHAUSTED" : "RESULT_BOUND_REACHED" },
        counts: { pagesRequested: 1, pagesCompleted: 1, received: listed.length, mapped: jobs.length, rejected: listed.length - jobs.length },
        jobs, errors: [],
      };
    } catch (error) {
      return enumerationFailure({
        sourceId: this.source.id, adapterVersion: AshbyAdapter.version,
        message: error instanceof Error ? error.message : "Ashby source request failed.",
        code: "ashby_request_failed", category: adapterErrorCategory(error), pagesRequested: 1,
      });
    }
  }

  async fetchJobs(): Promise<RawJobPosting[]> {
    return legacyJobs(await this.enumerateJobs());
  }

  private endpoint() { return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(this.source.adapterKey!)}?includeCompensation=true`; }

  private mapPosting(posting: AshbyJob): RawJobPosting | null {
    const title = text(posting.title); const url = configuredUrl(this.source, text(posting.jobUrl));
    if (!title || !url || !this.source.employerDisplayName) return null;
    const externalJobId = new URL(url).pathname.split("/").filter(Boolean).at(-1) || url;
    return { rawSourceEvidence: captureRawSourceEvidence(AshbyAdapter.version, posting), sourceId: this.source.id, employerName: this.source.employerDisplayName, externalJobId, title,
      description: text(posting.descriptionPlain), department: text(posting.department) || text(posting.team), sourceJobUrl: url,
      officialApplicationUrl: configuredUrl(this.source, text(posting.applyUrl)) || url, location: text(posting.location), employmentType: text(posting.employmentType),
      postedAt: text(posting.publishedAt), lastVerifiedAt: new Date().toISOString() };
  }
}

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function configuredUrl(source: SourceDefinition, value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return sourceUrlMatchesDefinition(source, url.toString()) ? url.toString() : null; } catch { return null; }
}
