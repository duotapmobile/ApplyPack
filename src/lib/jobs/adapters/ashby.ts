import { fetchOfficialJson, readBoundedJson } from "./fetch-policy";
import type { JobSourceAdapter, SourceHealth } from "./types";
import type { RawJobPosting, SourceDefinition } from "../types";
import { sourceUrlMatchesDefinition } from "../source-registry";

type AshbyJob = {
  title?: unknown; location?: unknown; department?: unknown; team?: unknown;
  descriptionPlain?: unknown; jobUrl?: unknown; applyUrl?: unknown; publishedAt?: unknown;
  employmentType?: unknown; isListed?: unknown;
};

export class AshbyAdapter implements JobSourceAdapter {
  constructor(readonly source: SourceDefinition) {
    if (!source.adapterKey) throw new Error(`Ashby source ${source.id} has no job-board name.`);
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchOfficialJson(this.endpoint(), ["api.ashbyhq.com"]);
      if (response.status === 429) return { sourceId: this.source.id, status: "rate_limited", checkedAt, httpStatus: 429, message: "Ashby requested a slower request rate." };
      if (!response.ok) return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: response.status, message: "Ashby did not return a successful response." };
      return { sourceId: this.source.id, status: "healthy", checkedAt, httpStatus: response.status, message: "Published Ashby Job Postings API is available." };
    } catch (error) {
      return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: null, message: error instanceof Error ? error.message : "Source health check failed." };
    }
  }

  async fetchJobs(): Promise<RawJobPosting[]> {
    const response = await fetchOfficialJson(this.endpoint(), ["api.ashbyhq.com"]);
    if (response.status === 429) throw new Error("Ashby source is rate limited; no jobs were changed.");
    if (!response.ok) throw new Error(`Ashby source returned HTTP ${response.status}; no jobs were changed.`);
    const payload = await readBoundedJson(response) as { jobs?: unknown };
    if (!Array.isArray(payload.jobs)) throw new Error("Ashby source returned an unexpected payload.");
    const maximum = boundedCount(process.env.APP_JOB_SOURCE_MAX_POSTINGS, 250);
    return payload.jobs.filter((job) => (job as AshbyJob).isListed !== false).slice(0, maximum).map((job) => this.mapPosting(job as AshbyJob)).filter((job): job is RawJobPosting => Boolean(job));
  }

  private endpoint() { return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(this.source.adapterKey!)}?includeCompensation=true`; }

  private mapPosting(posting: AshbyJob): RawJobPosting | null {
    const title = text(posting.title); const url = configuredUrl(this.source, text(posting.jobUrl));
    if (!title || !url || !this.source.employerDisplayName) return null;
    const externalJobId = new URL(url).pathname.split("/").filter(Boolean).at(-1) || url;
    return { sourceId: this.source.id, employerName: this.source.employerDisplayName, externalJobId, title,
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
function boundedCount(value: string | undefined, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : fallback; }
