import { captureRawSourceEvidence } from "../raw-source-evidence";
import { fetchOfficialJson, readBoundedJson } from "./fetch-policy";
import { adapterAllowedHosts, adapterErrorCategory, enumerationFailure, legacyJobs, retryAfterSeconds, sourceRequestTimeout, sourceResultBound } from "./enumeration-result";
import type { JobEnumerationOptions, JobEnumerationResult, JobSourceAdapter, SourceHealth } from "./types";
import type { RawJobPosting, SourceDefinition } from "../types";
import { sourceUrlMatchesDefinition } from "../source-registry";

type GreenhouseJob = {
  id?: unknown;
  title?: unknown;
  absolute_url?: unknown;
  updated_at?: unknown;
  content?: unknown;
  location?: { name?: unknown };
  departments?: Array<{ name?: unknown }>;
};

export class GreenhouseAdapter implements JobSourceAdapter {
  static readonly version = "greenhouse-v3";

  constructor(readonly source: SourceDefinition) {
    if (!source.adapterKey) throw new Error(`Greenhouse source ${source.id} has no board token.`);
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchOfficialJson(this.endpoint(), adapterAllowedHosts(this.source, ["boards-api.greenhouse.io"]));
      if (response.status === 429) return { sourceId: this.source.id, status: "rate_limited", checkedAt, httpStatus: 429, message: "Greenhouse requested a slower request rate." };
      if (!response.ok) return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: response.status, message: "Greenhouse did not return a successful response." };
      return { sourceId: this.source.id, status: "healthy", checkedAt, httpStatus: response.status, message: "Published Greenhouse Job Board API is available." };
    } catch (error) {
      return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: null, message: error instanceof Error ? error.message : "Source health check failed." };
    }
  }

  async enumerateJobs(options: JobEnumerationOptions = {}): Promise<JobEnumerationResult> {
    try {
      await options.beforeRequest?.();
      const response = await fetchOfficialJson(this.endpoint(), adapterAllowedHosts(this.source, ["boards-api.greenhouse.io"]), { timeoutMs: sourceRequestTimeout(options) });
      if (response.status === 429) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: GreenhouseAdapter.version, message: "Greenhouse source is rate limited; no jobs were changed.",
        code: "greenhouse_rate_limited", category: "rate_limit", httpStatus: 429, retryAfterSeconds: retryAfterSeconds(response), pagesRequested: 1,
      });
      if (!response.ok) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: GreenhouseAdapter.version,
        message: `Greenhouse source returned HTTP ${response.status}; no jobs were changed.`,
        code: "greenhouse_http_error", category: "http", httpStatus: response.status, pagesRequested: 1,
      });
      const payload = await readBoundedJson(response, options.maximumResponseBytes) as { jobs?: unknown };
      if (!Array.isArray(payload.jobs)) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: GreenhouseAdapter.version,
        message: "Greenhouse source returned an unexpected payload.", code: "greenhouse_invalid_payload",
        category: "payload", httpStatus: response.status, pagesRequested: 1, pagesCompleted: 1,
      });
      const maximum = sourceResultBound(options.resultBound);
      const jobs = payload.jobs.slice(0, maximum).map((job) => this.mapPosting(job as GreenhouseJob))
        .filter((job): job is RawJobPosting => Boolean(job));
      const complete = payload.jobs.length <= maximum;
      return {
        sourceId: this.source.id, adapterVersion: GreenhouseAdapter.version,
        completion: complete ? "complete" : "partial",
        responseClassification: complete ? "success" : "bounded_partial",
        checkpoint: { cursor: null, stopReason: complete ? "SOURCE_EXHAUSTED" : "RESULT_BOUND_REACHED" },
        counts: { pagesRequested: 1, pagesCompleted: 1, received: payload.jobs.length, mapped: jobs.length, rejected: payload.jobs.length - jobs.length },
        jobs, errors: [],
      };
    } catch (error) {
      return enumerationFailure({
        sourceId: this.source.id, adapterVersion: GreenhouseAdapter.version,
        message: error instanceof Error ? error.message : "Greenhouse source request failed.",
        code: "greenhouse_request_failed", category: adapterErrorCategory(error), pagesRequested: 1,
      });
    }
  }

  async fetchJobs(): Promise<RawJobPosting[]> {
    return legacyJobs(await this.enumerateJobs());
  }

  private endpoint() {
    return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(this.source.adapterKey!)}/jobs?content=true`;
  }

  private mapPosting(posting: GreenhouseJob): RawJobPosting | null {
    const id = posting.id == null ? null : String(posting.id);
    const title = text(posting.title);
    const url = secureConfiguredUrl(this.source, text(posting.absolute_url));
    if (!id || !title || !url || !this.source.employerDisplayName) return null;
    return {
      rawSourceEvidence: captureRawSourceEvidence(GreenhouseAdapter.version, posting),
      sourceId: this.source.id,
      employerName: this.source.employerDisplayName,
      externalJobId: id,
      title,
      description: stripHtml(text(posting.content)),
      department: posting.departments?.map((department) => text(department.name)).filter(Boolean).join(", ") || null,
      sourceJobUrl: url,
      officialApplicationUrl: url,
      location: text(posting.location?.name),
      lastVerifiedAt: new Date().toISOString(),
      postedAt: text(posting.updated_at),
    };
  }
}

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function secureConfiguredUrl(source: SourceDefinition, value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    return sourceUrlMatchesDefinition(source, url.toString()) ? url.toString() : null;
  } catch { return null; }
}
function stripHtml(value: string | null): string { return (value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
