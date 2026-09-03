import { fetchOfficialJson, readBoundedJson } from "./fetch-policy";
import type { JobSourceAdapter, SourceHealth } from "./types";
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
  constructor(readonly source: SourceDefinition) {
    if (!source.adapterKey) throw new Error(`Lever source ${source.id} has no site key.`);
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetchOfficialJson(this.endpoint(1), ["api.lever.co"]);
      if (response.status === 429) return { sourceId: this.source.id, status: "rate_limited", checkedAt, httpStatus: 429, message: "Lever requested a slower request rate." };
      if (!response.ok) return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: response.status, message: "Lever did not return a successful response." };
      return { sourceId: this.source.id, status: "healthy", checkedAt, httpStatus: response.status, message: "Published Lever postings endpoint is available." };
    } catch (error) {
      return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: null, message: error instanceof Error ? error.message : "Source health check failed." };
    }
  }

  async fetchJobs(): Promise<RawJobPosting[]> {
    const maximum = boundedCount(process.env.APP_JOB_SOURCE_MAX_POSTINGS, 250);
    const response = await fetchOfficialJson(this.endpoint(maximum), ["api.lever.co"]);
    if (response.status === 429) throw new Error("Lever source is rate limited; no jobs were changed.");
    if (!response.ok) throw new Error(`Lever source returned HTTP ${response.status}; no jobs were changed.`);
    const value = await readBoundedJson(response);
    if (!Array.isArray(value)) throw new Error("Lever source returned an unexpected payload.");
    return value.slice(0, maximum).map((posting) => this.mapPosting(posting as LeverPosting)).filter((job): job is RawJobPosting => Boolean(job));
  }

  private endpoint(limit: number) {
    return `https://api.lever.co/v0/postings/${encodeURIComponent(this.source.adapterKey!)}?mode=json&limit=${limit}`;
  }

  private mapPosting(posting: LeverPosting): RawJobPosting | null {
    const id = text(posting.id);
    const title = text(posting.text);
    const sourceJobUrl = text(posting.hostedUrl);
    if (!id || !title || !sourceJobUrl || !this.source.employerDisplayName) return null;
    const description = text(posting.descriptionPlain) || stripHtml(text(posting.description));
    const listText = Array.isArray(posting.lists)
      ? posting.lists.map((item) => stripHtml(JSON.stringify(item))).join(" ")
      : "";
    const location = text(posting.categories?.location) || arrayText(posting.categories?.allLocations).join(", ");
    return {
      sourceId: this.source.id,
      employerName: this.source.employerDisplayName,
      externalJobId: id,
      title,
      description: [description, listText].filter(Boolean).join("\n"),
      department: text(posting.categories?.department) || text(posting.categories?.team),
      sourceJobUrl,
      officialApplicationUrl: text(posting.applyUrl) || sourceJobUrl,
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

function boundedCount(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : fallback;
}
