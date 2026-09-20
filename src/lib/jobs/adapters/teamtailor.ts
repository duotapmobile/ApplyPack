import { captureRawSourceEvidence } from "../raw-source-evidence";
import type { RawJobPosting, SourceDefinition } from "../types";
import { sourceUrlMatchesDefinition } from "../source-registry";
import { adapterAllowedHosts, adapterErrorCategory, enumerationFailure, legacyJobs, retryAfterSeconds, sourceRequestBound, sourceRequestTimeout, sourceResultBound } from "./enumeration-result";
import { fetchOfficialText, readBoundedText } from "./fetch-policy";
import type { JobEnumerationOptions, JobEnumerationResult, JobSourceAdapter, SourceHealth } from "./types";

export class TeamtailorAdapter implements JobSourceAdapter {
  static readonly version = "teamtailor-rss-v2";

  constructor(readonly source: SourceDefinition) {
    if (!source.officialUrl) throw new Error(`Teamtailor source ${source.id} has no official career URL.`);
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const endpoint = this.endpoint(1, 0);
      const response = await fetchOfficialText(endpoint, adapterAllowedHosts(this.source, [new URL(endpoint).hostname]));
      if (response.status === 429) return { sourceId: this.source.id, status: "rate_limited", checkedAt, httpStatus: 429, message: "Teamtailor requested a slower request rate." };
      if (!response.ok) return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: response.status, message: "Teamtailor did not return a successful response." };
      return { sourceId: this.source.id, status: "healthy", checkedAt, httpStatus: response.status, message: "Published Teamtailor RSS feed is available." };
    } catch (error) {
      return { sourceId: this.source.id, status: "unavailable", checkedAt, httpStatus: null, message: error instanceof Error ? error.message : "Source health check failed." };
    }
  }

  async enumerateJobs(options: JobEnumerationOptions = {}): Promise<JobEnumerationResult> {
    const maximum = sourceResultBound(options.resultBound);
    const jobs: RawJobPosting[] = [];
    let received = 0;
    let pagesRequested = 0;
    let pagesCompleted = 0;
    let offset = checkpointOffset(options.checkpoint);
    const maximumRequests = Math.min(sourceRequestBound(options.pageBound), sourceRequestBound(options.requestBound));
    try {
      while (received < maximum) {
        if (pagesRequested >= maximumRequests) {
          return {
            sourceId: this.source.id, adapterVersion: TeamtailorAdapter.version, completion: "partial",
            responseClassification: "bounded_partial", checkpoint: { cursor: String(offset), stopReason: "REQUEST_BOUND_REACHED" },
            counts: { pagesRequested, pagesCompleted, received, mapped: jobs.length, rejected: received - jobs.length },
            jobs, errors: [],
          };
        }
        const pageSize = Math.min(100, maximum - received);
        const endpoint = this.endpoint(pageSize, offset);
        pagesRequested += 1;
        await options.beforeRequest?.();
        const response = await fetchOfficialText(endpoint, adapterAllowedHosts(this.source, [new URL(endpoint).hostname]), { timeoutMs: sourceRequestTimeout(options) });
        if (response.status === 429) return enumerationFailure({
          sourceId: this.source.id, adapterVersion: TeamtailorAdapter.version,
          message: "Teamtailor source is rate limited; no jobs were changed.", code: "teamtailor_rate_limited",
          category: "rate_limit", httpStatus: 429, retryAfterSeconds: retryAfterSeconds(response),
          pagesRequested, pagesCompleted, received, jobs,
        });
        if (!response.ok) return enumerationFailure({
          sourceId: this.source.id, adapterVersion: TeamtailorAdapter.version,
          message: `Teamtailor source returned HTTP ${response.status}; no jobs were changed.`,
          code: "teamtailor_http_error", category: "http", httpStatus: response.status,
          pagesRequested, pagesCompleted, received, jobs,
        });
        const xml = await readBoundedText(response, options.maximumResponseBytes);
        const items = rssItems(xml);
        pagesCompleted += 1;
        received += items.length;
        jobs.push(...items.map((item) => this.mapItem(item)).filter((job): job is RawJobPosting => Boolean(job)));
        offset += items.length;
        if (items.length < pageSize) {
          return {
            sourceId: this.source.id, adapterVersion: TeamtailorAdapter.version, completion: "complete",
            responseClassification: "success", checkpoint: { cursor: String(offset), stopReason: "SOURCE_EXHAUSTED" },
            counts: { pagesRequested, pagesCompleted, received, mapped: jobs.length, rejected: received - jobs.length },
            jobs, errors: [],
          };
        }
      }
      return {
        sourceId: this.source.id, adapterVersion: TeamtailorAdapter.version, completion: "partial",
        responseClassification: "bounded_partial", checkpoint: { cursor: String(offset), stopReason: "RESULT_BOUND_REACHED" },
        counts: { pagesRequested, pagesCompleted, received, mapped: jobs.length, rejected: received - jobs.length },
        jobs, errors: [],
      };
    } catch (error) {
      return enumerationFailure({
        sourceId: this.source.id, adapterVersion: TeamtailorAdapter.version,
        message: error instanceof Error ? error.message : "Teamtailor source request failed.",
        code: "teamtailor_request_failed", category: adapterErrorCategory(error),
        pagesRequested, pagesCompleted, received, jobs,
      });
    }
  }

  async fetchJobs(): Promise<RawJobPosting[]> {
    return legacyJobs(await this.enumerateJobs());
  }

  private endpoint(perPage: number, offset: number) {
    const configured = this.source.adapterKey && /^https:\/\//.test(this.source.adapterKey)
      ? this.source.adapterKey
      : `${this.source.officialUrl!.replace(/\/+$/, "")}.rss`;
    const url = new URL(configured);
    if (url.protocol !== "https:" || !sourceUrlMatchesDefinition(this.source, url.toString())) {
      throw new Error("Teamtailor RSS URL is outside the configured official source.");
    }
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("offset", String(offset));
    return url.toString();
  }

  private mapItem(item: string): RawJobPosting | null {
    const title = xmlTag(item, "title");
    const sourceJobUrl = this.postingUrl(xmlTag(item, "link"));
    const guid = xmlTag(item, "guid") || sourceJobUrl;
    if (!title || !sourceJobUrl || !guid || !this.source.employerDisplayName) return null;
    return {
      rawSourceEvidence: captureRawSourceEvidence(TeamtailorAdapter.version, item),
      sourceId: this.source.id,
      employerName: this.source.employerDisplayName,
      externalJobId: guid,
      title,
      description: stripHtml(xmlTag(item, "description")),
      department: xmlTag(item, "category"),
      sourceJobUrl,
      officialApplicationUrl: sourceJobUrl,
      location: xmlTag(item, "tt:location") || xmlTag(item, "location"),
      postedAt: normalizedDate(xmlTag(item, "pubDate")),
      lastVerifiedAt: new Date().toISOString(),
    };
  }

  private postingUrl(value: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !sourceUrlMatchesDefinition(this.source, url.toString())) return null;
      if (this.source.authorizationAllowedHosts
        && !this.source.authorizationAllowedHosts.map((host) => host.toLowerCase()).includes(url.hostname.toLowerCase())) return null;
      return url.toString();
    } catch {
      return null;
    }
  }
}

function rssItems(xml: string): string[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Teamtailor RSS payload contains a forbidden declaration.");
  if (!/<rss\b|<feed\b/i.test(xml)) throw new Error("Teamtailor RSS payload is invalid.");
  return Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi), (match) => match[0]);
}

function xmlTag(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^$()|[\]{}]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  if (!match) return null;
  return decodeXml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim());
}

function decodeXml(value: string): string {
  return value.replace(/&#(x?[0-9a-f]+);/gi, (_match, number: string) => {
    const codePoint = Number.parseInt(number.replace(/^x/i, ""), number.toLowerCase().startsWith("x") ? 16 : 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  }).replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'").replace(/&amp;/gi, "&");
}

function stripHtml(value: string | null): string {
  return (value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function checkpointOffset(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) throw new Error("Teamtailor checkpoint is invalid.");
  return parsed;
}

function normalizedDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
