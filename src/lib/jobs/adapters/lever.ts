import { captureRawSourceEvidence } from "../raw-source-evidence";
import { fetchOfficialJson, readBoundedJson } from "./fetch-policy";
import { adapterAllowedHosts, adapterErrorCategory, enumerationFailure, legacyJobs, retryAfterSeconds, sourceRequestBound, sourceRequestTimeout } from "./enumeration-result";
import type { JobEnumerationOptions, JobEnumerationResult, JobSourceAdapter, SourceHealth } from "./types";
import type { RawJobPosting, SourceDefinition } from "../types";

type LeverPosting = {
  id?: unknown;
  text?: unknown;
  descriptionPlain?: unknown;
  description?: unknown;
  hostedUrl?: unknown;
  applyUrl?: unknown;
  createdAt?: unknown;
  categories?: {
    location?: unknown;
    commitment?: unknown;
    team?: unknown;
    department?: unknown;
    level?: unknown;
    allLocations?: unknown;
  };
  lists?: unknown;
};

export class LeverAdapter implements JobSourceAdapter {
  static readonly version = "lever-v3";

  constructor(readonly source: SourceDefinition) {
    if (!source.adapterKey) throw new Error(`Lever source ${source.id} has no site key.`);
    if (source.authorizationStatus !== "AUTHORIZED_AUTOMATED" || !source.authorizationEvidenceId) {
      throw new Error(`Lever source ${source.id} is not documentarily authorized for automated access.`);
    }
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchOfficialJson(this.endpoint(1, 0), adapterAllowedHosts(this.source, ["api.lever.co"]));
      if (response.status === 429) return { sourceId: this.source.id, status: "rate_limited", checkedAt, httpStatus: 429, message: "Lever requested a slower request rate." };
      if (!response.ok) return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: response.status, message: "Lever did not return a successful response." };
      return { sourceId: this.source.id, status: "healthy", checkedAt, httpStatus: response.status, message: "Published Lever postings endpoint is available." };
    } catch (error) {
      return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: null, message: error instanceof Error ? error.message : "Source health check failed." };
    }
  }

  async enumerateJobs(options: JobEnumerationOptions = {}): Promise<JobEnumerationResult> {
    const maximum = requiredBoundedCount(options.resultBound ?? process.env.APP_JOB_SOURCE_MAX_POSTINGS);
    const jobs: RawJobPosting[] = [];
    let received = 0;
    let pagesRequested = 0;
    let pagesCompleted = 0;
    let skip = checkpointOffset(options.checkpoint);
    const maximumRequests = Math.min(sourceRequestBound(options.pageBound), sourceRequestBound(options.requestBound));
    try {
      while (received < maximum) {
        if (pagesRequested >= maximumRequests) {
          return {
            sourceId: this.source.id, adapterVersion: LeverAdapter.version, completion: "partial",
            responseClassification: "bounded_partial", checkpoint: { cursor: String(skip), stopReason: "REQUEST_BOUND_REACHED" },
            counts: { pagesRequested, pagesCompleted, received, mapped: jobs.length, rejected: received - jobs.length },
            jobs, errors: [],
          };
        }
        const pageSize = Math.min(100, maximum - received);
        pagesRequested += 1;
        await options.beforeRequest?.();
        const response = await fetchOfficialJson(this.endpoint(pageSize, skip), adapterAllowedHosts(this.source, ["api.lever.co"]), { timeoutMs: sourceRequestTimeout(options) });
        if (response.status === 429) return enumerationFailure({
          sourceId: this.source.id, adapterVersion: LeverAdapter.version, message: "Lever source is rate limited; no jobs were changed.",
          code: "lever_rate_limited", category: "rate_limit", httpStatus: 429, retryAfterSeconds: retryAfterSeconds(response),
          pagesRequested, pagesCompleted, received, jobs,
        });
        if (!response.ok) return enumerationFailure({
          sourceId: this.source.id, adapterVersion: LeverAdapter.version,
          message: `Lever source returned HTTP ${response.status}; no jobs were changed.`,
          code: "lever_http_error", category: "http", httpStatus: response.status,
          pagesRequested, pagesCompleted, received, jobs,
        });
        const value = await readBoundedJson(response, options.maximumResponseBytes);
        if (!Array.isArray(value)) return enumerationFailure({
          sourceId: this.source.id, adapterVersion: LeverAdapter.version,
          message: "Lever source returned an unexpected payload.", code: "lever_invalid_payload",
          category: "payload", httpStatus: response.status, pagesRequested, pagesCompleted, received, jobs,
        });
        pagesCompleted += 1;
        received += value.length;
        jobs.push(...value.map((posting) => this.mapPosting(posting as LeverPosting))
          .filter((job): job is RawJobPosting => Boolean(job)));
        skip += value.length;
        if (value.length < pageSize) {
          return {
            sourceId: this.source.id, adapterVersion: LeverAdapter.version, completion: "complete",
            responseClassification: "success", checkpoint: { cursor: String(skip), stopReason: "SOURCE_EXHAUSTED" },
            counts: { pagesRequested, pagesCompleted, received, mapped: jobs.length, rejected: received - jobs.length },
            jobs, errors: [],
          };
        }
      }
      return {
        sourceId: this.source.id, adapterVersion: LeverAdapter.version, completion: "partial",
        responseClassification: "bounded_partial", checkpoint: { cursor: String(skip), stopReason: "RESULT_BOUND_REACHED" },
        counts: { pagesRequested, pagesCompleted, received, mapped: jobs.length, rejected: received - jobs.length },
        jobs, errors: [],
      };
    } catch (error) {
      return enumerationFailure({
        sourceId: this.source.id, adapterVersion: LeverAdapter.version,
        message: error instanceof Error ? error.message : "Lever source request failed.",
        code: "lever_request_failed", category: adapterErrorCategory(error), pagesRequested, pagesCompleted, received, jobs,
      });
    }
  }

  async fetchJobs(): Promise<RawJobPosting[]> {
    return legacyJobs(await this.enumerateJobs());
  }

  private endpoint(limit: number, skip: number) {
    return `https://api.lever.co/v0/postings/${encodeURIComponent(this.source.adapterKey!)}?mode=json&limit=${limit}&skip=${skip}`;
  }

  private mapPosting(posting: LeverPosting): RawJobPosting | null {
    const id = text(posting.id);
    const title = text(posting.text);
    const sourceJobUrl = leverPostingUrl(this.source, text(posting.hostedUrl));
    if (!id || !title || !sourceJobUrl || !this.source.employerDisplayName) return null;
    const description = text(posting.descriptionPlain) || stripHtml(text(posting.description));
    const listText = Array.isArray(posting.lists)
      ? posting.lists.map((item) => stripHtml(JSON.stringify(item))).join(" ")
      : "";
    const location = text(posting.categories?.location) || arrayText(posting.categories?.allLocations).join(", ");
    return {
      rawSourceEvidence: captureRawSourceEvidence(LeverAdapter.version, posting),
      sourceId: this.source.id,
      employerName: this.source.employerDisplayName,
      externalJobId: id,
      title,
      description: [description, listText].filter(Boolean).join("\n"),
      department: text(posting.categories?.department) || text(posting.categories?.team),
      sourceJobUrl,
      officialApplicationUrl: leverPostingUrl(this.source, text(posting.applyUrl)) || sourceJobUrl,
      location,
      employmentType: text(posting.categories?.commitment),
      postedAt: typeof posting.createdAt === "number" ? new Date(posting.createdAt).toISOString() : null,
      lastVerifiedAt: new Date().toISOString(),
    };
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stripHtml(value: string | null): string {
  return (value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function requiredBoundedCount(value: string | number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("Source result bound is required configuration.");
  return Math.min(500, Math.floor(parsed));
}

function checkpointOffset(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) throw new Error("Lever checkpoint is invalid.");
  return parsed;
}

function leverPostingUrl(source: SourceDefinition, value: string | null): string | null {
  if (!value || !source.adapterKey) return null;
  try {
    const url = new URL(value);
    const [tenant] = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || url.hostname !== "jobs.lever.co" || tenant !== source.adapterKey) return null;
    return url.toString();
  } catch {
    return null;
  }
}
