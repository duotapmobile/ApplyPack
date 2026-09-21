import { captureRawSourceEvidence } from "../raw-source-evidence";
import type { RawJobPosting, SourceDefinition } from "../types";
import { sourceUrlMatchesDefinition } from "../source-registry";
import { adapterAllowedHosts, adapterErrorCategory, enumerationFailure, legacyJobs, retryAfterSeconds, sourceRequestTimeout, sourceResultBound } from "./enumeration-result";
import { fetchOfficialJson, readBoundedJson } from "./fetch-policy";
import type { JobEnumerationOptions, JobEnumerationResult, JobSourceAdapter, SourceHealth } from "./types";

type RecruiteeOffer = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  careers_url?: unknown;
  url?: unknown;
  apply_url?: unknown;
  location?: unknown;
  employment_type?: unknown;
  department?: unknown;
  created_at?: unknown;
  published_at?: unknown;
};

export class RecruiteeAdapter implements JobSourceAdapter {
  static readonly version = "recruitee-v2";

  constructor(readonly source: SourceDefinition) {
    if (!source.adapterKey || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(source.adapterKey)) {
      throw new Error(`Recruitee source ${source.id} has no valid company identifier.`);
    }
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchOfficialJson(this.endpoint(), adapterAllowedHosts(this.source, [this.apiHost()]));
      if (response.status === 429) return { sourceId: this.source.id, status: "rate_limited", checkedAt, httpStatus: 429, message: "Recruitee requested a slower request rate." };
      if (!response.ok) return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: response.status, message: "Recruitee did not return a successful response." };
      return { sourceId: this.source.id, status: "healthy", checkedAt, httpStatus: response.status, message: "Published Recruitee company offers feed is available." };
    } catch (error) {
      return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: null, message: error instanceof Error ? error.message : "Source health check failed." };
    }
  }

  async enumerateJobs(options: JobEnumerationOptions = {}): Promise<JobEnumerationResult> {
    try {
      await options.beforeRequest?.();
      const response = await fetchOfficialJson(this.endpoint(), adapterAllowedHosts(this.source, [this.apiHost()]), { timeoutMs: sourceRequestTimeout(options) });
      if (response.status === 429) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: RecruiteeAdapter.version,
        message: "Recruitee source is rate limited; no jobs were changed.", code: "recruitee_rate_limited",
        category: "rate_limit", httpStatus: 429, retryAfterSeconds: retryAfterSeconds(response), pagesRequested: 1,
      });
      if (!response.ok) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: RecruiteeAdapter.version,
        message: `Recruitee source returned HTTP ${response.status}; no jobs were changed.`,
        code: "recruitee_http_error", category: "http", httpStatus: response.status, pagesRequested: 1,
      });
      const payload = await readBoundedJson(response, options.maximumResponseBytes) as { offers?: unknown };
      if (!Array.isArray(payload.offers)) return enumerationFailure({
        sourceId: this.source.id, adapterVersion: RecruiteeAdapter.version,
        message: "Recruitee source returned an unexpected payload.", code: "recruitee_invalid_payload",
        category: "payload", httpStatus: response.status, pagesRequested: 1, pagesCompleted: 1,
      });
      const maximum = sourceResultBound(options.resultBound);
      const jobs = payload.offers.slice(0, maximum).map((offer) => this.mapOffer(offer as RecruiteeOffer))
        .filter((job): job is RawJobPosting => Boolean(job));
      const complete = payload.offers.length <= maximum;
      return {
        sourceId: this.source.id, adapterVersion: RecruiteeAdapter.version,
        completion: complete ? "complete" : "partial",
        responseClassification: complete ? "success" : "bounded_partial",
        checkpoint: { cursor: null, stopReason: complete ? "SOURCE_EXHAUSTED" : "RESULT_BOUND_REACHED" },
        counts: { pagesRequested: 1, pagesCompleted: 1, received: payload.offers.length, mapped: jobs.length, rejected: payload.offers.length - jobs.length },
        jobs, errors: [],
      };
    } catch (error) {
      return enumerationFailure({
        sourceId: this.source.id, adapterVersion: RecruiteeAdapter.version,
        message: error instanceof Error ? error.message : "Recruitee source request failed.",
        code: "recruitee_request_failed", category: adapterErrorCategory(error), pagesRequested: 1,
      });
    }
  }

  async fetchJobs(): Promise<RawJobPosting[]> {
    return legacyJobs(await this.enumerateJobs());
  }

  private apiHost() {
    return `${this.source.adapterKey}.recruitee.com`;
  }

  private endpoint() {
    return `https://${this.apiHost()}/api/offers`;
  }

  private mapOffer(offer: RecruiteeOffer): RawJobPosting | null {
    const id = offer.id == null ? null : String(offer.id);
    const title = text(offer.title);
    const sourceJobUrl = this.postingUrl(text(offer.careers_url) || text(offer.url));
    if (!id || !title || !sourceJobUrl || !this.source.employerDisplayName) return null;
    return {
      rawSourceEvidence: captureRawSourceEvidence(RecruiteeAdapter.version, offer),
      sourceId: this.source.id,
      employerName: this.source.employerDisplayName,
      externalJobId: id,
      title,
      description: stripHtml(text(offer.description)),
      department: text(offer.department),
      sourceJobUrl,
      officialApplicationUrl: this.postingUrl(text(offer.apply_url)) || sourceJobUrl,
      location: locationText(offer.location),
      employmentType: text(offer.employment_type),
      postedAt: text(offer.published_at) || text(offer.created_at),
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  private postingUrl(value: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return null;
      const hostAllowedByDefinition = url.hostname === this.apiHost() || sourceUrlMatchesDefinition(this.source, url.toString());
      const hostAllowedByAuthorization = !this.source.authorizationAllowedHosts
        || this.source.authorizationAllowedHosts.map((host) => host.toLowerCase()).includes(url.hostname.toLowerCase());
      return hostAllowedByDefinition && hostAllowedByAuthorization ? url.toString() : null;
    } catch {
      return null;
    }
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function locationText(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object") return null;
  const location = value as Record<string, unknown>;
  return [location.name, location.city, location.state, location.country]
    .map(text).filter((part): part is string => Boolean(part)).join(", ") || null;
}

function stripHtml(value: string | null): string {
  return (value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}
