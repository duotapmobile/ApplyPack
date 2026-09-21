import { duplicateEdgeReason, selectIndependentInventory, stableNormalizedJobId } from "@/lib/matching/deduplication";
import { normalizeUrl } from "./normalize";
import type { DeduplicatedJob, JobSourceReference, NormalizedJob } from "./types";

export function deduplicateJobs(jobs: readonly NormalizedJob[]): DeduplicatedJob[] {
  const graph = selectIndependentInventory(jobs);
  return graph.selected.map((selected) => {
    const selectedId = stableNormalizedJobId(selected);
    const displaced = graph.displacements.filter((item) => item.selectedId === selectedId);
    const memberIds = new Set([selectedId, ...displaced.map((item) => item.displacedId)]);
    const references = jobs.filter((job) => memberIds.has(stableNormalizedJobId(job))).map(toReference)
      .filter((reference, index, all) => all.findIndex((other) => sameReference(reference, other)) === index);
    const matchedBy = displaced.some((item) => item.edgeReason === "external_job_id") ? "external_job_id"
      : displaced.some((item) => item.edgeReason === "canonical_url") ? "source_url"
        : displaced.some((item) => item.edgeReason === "fingerprint") ? "content" : "new";
    return { job: selected, sourceReferences: references, matchedBy, displaced };
  });
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

export function finalPairwiseDuplicateCheck(jobs: readonly NormalizedJob[]) {
  return jobs.every((job, index) => jobs.slice(index + 1).every((other) => duplicateEdgeReason(job, other) === null));
}
