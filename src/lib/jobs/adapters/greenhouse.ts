import { captureRawSourceEvidence } from "../raw-source-evidence";
import { fetchOfficialJson, readBoundedJson } from "./fetch-policy";
import { adapterAllowedHosts, adapterErrorCategory, enumerationFailure, legacyJobs, retryAfterSeconds, sourceRequestBound, sourceRequestTimeout, sourceResultBound } from "./enumeration-result";
import { APPLICATION_QUESTION_ACTION, GREENHOUSE_QUESTION_CAPTURE_VERSION, greenhouseQuestionUrl,
  questionCaptureAuthoritySchema, questionResponseSha256, validateGreenhouseQuestionCapture, type GreenhouseQuestionCapture } from "../application-question-evidence";
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
  static readonly version = "greenhouse-v5";

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
    let detailRequests = 0;
    let questionBackoff = false;
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
      for (const job of jobs) {
        // A known API is not permission to inspect the form. The action and
        // current run/lease are required independently of job enumeration.
        if (!job.externalJobId || !/^\d{1,18}$/.test(job.externalJobId) || !/^[A-Za-z0-9_-]{1,120}$/.test(this.source.adapterKey!)) continue;
        const authority = questionCaptureAuthoritySchema.safeParse(options.questionCaptureAuthority);
        const capture: GreenhouseQuestionCapture = {
          schemaVersion: GREENHOUSE_QUESTION_CAPTURE_VERSION, sourceId: this.source.id,
          boardToken: this.source.adapterKey!, externalJobId: job.externalJobId,
          sourceUrl: greenhouseQuestionUrl(this.source.adapterKey!, job.externalJobId), capturedAt: new Date().toISOString(),
          authority: authority.success ? authority.data : null, outcome: "NOT_INSPECTED", reasonCode: "ACTION_NOT_AUTHORIZED",
          httpStatus: null, rawResponse: null, rawResponseSha256: null,
        };
        const authorized = this.source.authorizationStatus === "AUTHORIZED_AUTOMATED" && Boolean(this.source.authorizationEvidenceId)
          && this.source.authorizationAllowedActions?.includes(APPLICATION_QUESTION_ACTION);
        if (authorized) {
          if (!authority.success || !options.beforeRequest || authority.data.authorizationId !== this.source.authorizationEvidenceId
            || authority.data.authorizationVersion !== this.source.authorizationVersion) capture.reasonCode = "AUTHORITY_MISSING";
          else if (questionBackoff) capture.reasonCode = "SOURCE_BACKOFF";
          else if (1 + detailRequests >= sourceRequestBound(options.requestBound)) capture.reasonCode = "REQUEST_BOUND";
          else if (options.deadlineAtMs !== undefined && options.deadlineAtMs <= Date.now()) capture.reasonCode = "DEADLINE";
          else {
            let authorityRejected = false;
            try {
              const detail = await fetchOfficialJson(capture.sourceUrl, adapterAllowedHosts(this.source, ["boards-api.greenhouse.io"]), {
                timeoutMs: sourceRequestTimeout(options), beforeFetch: async () => {
                  try { await options.beforeRequest!(APPLICATION_QUESTION_ACTION); }
                  catch (error) { authorityRejected = true; throw error; }
                  if (options.deadlineAtMs !== undefined && options.deadlineAtMs <= Date.now()) throw new Error("question_capture_deadline");
                  detailRequests += 1;
                },
              });
              capture.httpStatus = detail.status;
              if (detail.status !== 200) {
                if (detail.status === 429 || detail.status === 503 || detail.headers.has("retry-after")) questionBackoff = true;
                capture.outcome = [401, 403, 404, 410].includes(detail.status) ? "INACCESSIBLE" : "FAILED";
                capture.reasonCode = capture.outcome === "INACCESSIBLE" ? "HTTP_INACCESSIBLE" : "HTTP_FAILURE";
              } else {
                const raw = await readBoundedJson(detail, Math.min(options.maximumResponseBytes ?? 512_000, 512_000));
                const candidate = { ...capture, outcome: "RESPONSE" as const, reasonCode: "CAPTURED" as const,
                  rawResponse: raw, rawResponseSha256: questionResponseSha256(raw), capturedAt: new Date().toISOString() };
                const verified = validateGreenhouseQuestionCapture(candidate);
                const responseUrl = verified.rawResponse && !Array.isArray(verified.rawResponse) && typeof verified.rawResponse === "object"
                  ? verified.rawResponse.absolute_url : null;
                if (typeof responseUrl !== "string" || secureConfiguredUrl(this.source, responseUrl) !== job.officialApplicationUrl
                  || !greenhouseBoardMatches(this.source.adapterKey!, job.externalJobId, responseUrl)) throw new Error("question_capture_listing_mismatch");
                Object.assign(capture, verified);
              }
            } catch (error) {
              // Revoked authority/lease is a failed run, not optional missing
              // question data that could be published under stale permission.
              if (authorityRejected) throw error;
              Object.assign(capture, { outcome: "FAILED", reasonCode: "TRANSPORT_OR_PAYLOAD_FAILURE", rawResponse: null, rawResponseSha256: null });
            }
          }
        }
        job.applicationQuestionObservation = capture;
        job.rawSourceEvidence = captureRawSourceEvidence(GreenhouseAdapter.version, {
          listing: job.rawSourceEvidence!.payload, applicationQuestionObservation: capture,
        });
        job.lastVerifiedAt = new Date().toISOString();
      }
      const complete = payload.jobs.length <= maximum;
      return {
        sourceId: this.source.id, adapterVersion: GreenhouseAdapter.version,
        completion: complete ? "complete" : "partial",
        responseClassification: complete ? "success" : "bounded_partial",
        checkpoint: { cursor: null, stopReason: complete ? "SOURCE_EXHAUSTED" : "RESULT_BOUND_REACHED" },
        counts: { pagesRequested: 1, pagesCompleted: 1, detailRequests, received: payload.jobs.length, mapped: jobs.length, rejected: payload.jobs.length - jobs.length },
        jobs, errors: [],
      };
    } catch (error) {
      const failure = enumerationFailure({
        sourceId: this.source.id, adapterVersion: GreenhouseAdapter.version,
        message: error instanceof Error ? error.message : "Greenhouse source request failed.",
        code: "greenhouse_request_failed", category: adapterErrorCategory(error), pagesRequested: 1,
      });
      failure.counts.detailRequests = detailRequests;
      return failure;
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
function stripHtml(value: string | null): string {
  // Greenhouse documents entity-encoded editor HTML. Decode at most the two
  // published layers; this is text processing only, never DOM execution.
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", hellip: "…" };
  let decoded = value || "";
  for (let pass = 0; pass < 2; pass++) {
    decoded = decoded.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/giu, (_whole, entity: string) => {
      const key = entity.toLowerCase();
      if (!key.startsWith("#")) {
        if (!Object.hasOwn(entities, key)) throw new Error("greenhouse_content_encoding_unsupported");
        return entities[key];
      }
      const point = Number.parseInt(key.slice(key.startsWith("#x") ? 2 : 1), key.startsWith("#x") ? 16 : 10);
      if (!Number.isSafeInteger(point) || point < 1 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff
        || point < 32 && ![9, 10, 13].includes(point)) throw new Error("greenhouse_content_encoding_invalid");
      return String.fromCodePoint(point);
    });
  }
  if (/&(?:#[^\s&]*|(?:amp|lt|gt|quot|apos|nbsp)(?:;|\b)|[a-z][a-z0-9]*;)/iu.test(decoded)) throw new Error("greenhouse_content_encoding_unresolved");
  const inert = decoded.replace(/<script\b[\s\S]*?<\/script\s*>/giu, " ").replace(/<style\b[\s\S]*?<\/style\s*>/giu, " ").replace(/<!--[\s\S]*?-->/gu, " ");
  if (/<(?:script|style)\b|<!--/iu.test(inert)) throw new Error("greenhouse_content_markup_invalid");
  const stripped = inert
    .replace(/<\/?(?:p|div|section|article|h[1-6]|li|ul|ol|table|tr|blockquote|br)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, "\n")
    .replace(/<\/?[a-z][a-z0-9-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, " ");
  if (/<\/?[a-z!]/iu.test(stripped)) throw new Error("greenhouse_content_markup_invalid");
  return stripped.split(/\r?\n/u).map(line => line.replace(/\s+/gu, " ").trim()).filter(Boolean).join("\n").trim();
}

function greenhouseBoardMatches(board: string, jobId: string, value: string) {
  const url = new URL(value);
  if (!["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(url.hostname)) return !url.hostname.endsWith(".greenhouse.io");
  return url.pathname.replace(/\/$/, "") === `/${board}/jobs/${jobId}`;
}
