import { normalizeUrl } from "./normalize";
import type { DeduplicatedJob, JobSourceReference, NormalizedJob } from "./types";

export function deduplicateJobs(jobs: readonly NormalizedJob[]): DeduplicatedJob[] {
  const results: DeduplicatedJob[] = [];
  for (const incoming of jobs) {
    const match = findExactDuplicate(results, incoming);
    const reference = toReference(incoming);
    if (!match) {
      results.push({ job: incoming, sourceReferences: [reference], matchedBy: "new" });
      continue;
    }
    if (!match.sourceReferences.some((item) => sameReference(item, reference))) match.sourceReferences.push(reference);
    match.job = preferJob(match.job, incoming);
  }
  return results;
}

function findExactDuplicate(results: DeduplicatedJob[], incoming: NormalizedJob): DeduplicatedJob | undefined {
  for (const result of results) {
    if (result.job.canonicalEmployerId !== incoming.canonicalEmployerId) continue;
    if (incoming.externalJobId && result.sourceReferences.some((ref) => ref.externalJobId === incoming.externalJobId)) {
      result.matchedBy = "external_job_id";
      return result;
    }
    if (incoming.normalizedSourceUrl && result.sourceReferences.some((ref) => normalizeUrl(ref.sourceJobUrl) === incoming.normalizedSourceUrl)) {
      result.matchedBy = "source_url";
      return result;
    }
    if (result.job.deduplicationKey === incoming.deduplicationKey) {
      result.matchedBy = "content";
      return result;
    }
  }
  return undefined;
}

function preferJob(current: NormalizedJob, incoming: NormalizedJob): NormalizedJob {
  if (incoming.isOfficialSource && incoming.isDirectEmployerSource && !(current.isOfficialSource && current.isDirectEmployerSource)) {
    return { ...incoming, employerAliases: [...new Set([...current.employerAliases, ...incoming.employerAliases])] };
  }
  if (!current.officialApplicationUrl && incoming.officialApplicationUrl) {
    return { ...current, officialApplicationUrl: incoming.officialApplicationUrl };
  }
  return current;
}

function toReference(job: NormalizedJob): JobSourceReference {
  return {
    sourceId: job.sourceId,
    sourceName: job.sourceName,
    sourceJobUrl: job.sourceJobUrl,
    officialApplicationUrl: job.officialApplicationUrl,
    externalJobId: job.externalJobId,
    isOfficial: job.isOfficialSource,
    isDirectEmployer: job.isDirectEmployerSource,
    lastVerifiedAt: job.lastVerifiedAt,
  };
}

function sameReference(a: JobSourceReference, b: JobSourceReference): boolean {
  return a.sourceId === b.sourceId && a.externalJobId === b.externalJobId && normalizeUrl(a.sourceJobUrl) === normalizeUrl(b.sourceJobUrl);
}

export function fuzzySimilarity(a: NormalizedJob, b: NormalizedJob): number {
  if (a.canonicalEmployerId !== b.canonicalEmployerId) return 0;
  const left = new Set(a.normalizedTitle.split(" ").filter(Boolean));
  const right = new Set(b.normalizedTitle.split(" ").filter(Boolean));
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}
