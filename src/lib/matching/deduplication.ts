import { normalizeUrl } from "@/lib/jobs/normalize";
import type { NormalizedJob } from "@/lib/jobs/types";

export const DEDUPLICATION_POLICY_VERSION = "conflict-graph-mis-v1";
export type DuplicateEdgeReason = "external_job_id" | "canonical_url" | "fingerprint";
export type DuplicateEdge = { leftId: string; rightId: string; reason: DuplicateEdgeReason };

export function stableNormalizedJobId(job: NormalizedJob) {
  if (job.externalJobIdReliable !== false && job.externalJobId) return `requisition|${job.canonicalEmployerId}|${job.externalJobId}`;
  const applicationUrl = normalizeUrl(job.officialApplicationUrl);
  if (applicationUrl) return `application-url|${applicationUrl}`;
  const listingUrl = normalizeUrl(job.canonicalEmployerListingUrl);
  if (listingUrl) return `employer-listing-url|${listingUrl}`;
  return `fingerprint|${job.canonicalEmployerId}|${job.deduplicationKey}`;
}

function reliableRequisition(job: NormalizedJob) {
  return job.externalJobIdReliable !== false && Boolean(job.externalJobId);
}
function canonicalUrls(job: NormalizedJob) {
  return new Set([normalizeUrl(job.canonicalEmployerListingUrl), normalizeUrl(job.officialApplicationUrl)].filter((value): value is string => Boolean(value)));
}
function hasStrongIdentifier(job: NormalizedJob) {
  return reliableRequisition(job) || canonicalUrls(job).size > 0;
}

export function duplicateEdgeReason(a: NormalizedJob, b: NormalizedJob): DuplicateEdgeReason | null {
  if (a.canonicalEmployerId === b.canonicalEmployerId && reliableRequisition(a) && reliableRequisition(b) && a.externalJobId === b.externalJobId) return "external_job_id";
  const leftUrls = canonicalUrls(a), rightUrls = canonicalUrls(b);
  if ([...leftUrls].some((url) => rightUrls.has(url))) return "canonical_url";
  if ((!hasStrongIdentifier(a) || !hasStrongIdentifier(b)) && a.deduplicationKey && a.deduplicationKey === b.deduplicationKey) return "fingerprint";
  return null;
}

function completeness(job: NormalizedJob) {
  return (job.verifiedRequirementCount ?? 0) + (job.verifiedCompensationFieldCount ?? 0);
}

export function compareRecordQuality(a: NormalizedJob, b: NormalizedJob) {
  const reliableA = hasStrongIdentifier(a) ? 1 : 0, reliableB = hasStrongIdentifier(b) ? 1 : 0;
  const officialA = a.isActive && a.isOfficialSource && a.isDirectEmployerSource ? 1 : 0;
  const officialB = b.isActive && b.isOfficialSource && b.isDirectEmployerSource ? 1 : 0;
  return reliableB - reliableA
    || officialB - officialA
    || b.lastVerifiedAt.localeCompare(a.lastVerifiedAt)
    || completeness(b) - completeness(a)
    || (b.firstSeenAt ?? b.lastVerifiedAt).localeCompare(a.firstSeenAt ?? a.lastVerifiedAt)
    || stableNormalizedJobId(a).localeCompare(stableNormalizedJobId(b));
}

export function selectIndependentInventory(jobs: readonly NormalizedJob[]) {
  const byId = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    const id = stableNormalizedJobId(job);
    if (!id) throw new Error("missing_normalized_job_id");
    if (byId.has(id)) continue;
    byId.set(id, job);
  }
  const edges: DuplicateEdge[] = [];
  const records = [...byId.values()];
  for (let left = 0; left < records.length; left += 1) for (let right = left + 1; right < records.length; right += 1) {
    const reason = duplicateEdgeReason(records[left], records[right]);
    if (reason) edges.push({ leftId: stableNormalizedJobId(records[left]), rightId: stableNormalizedJobId(records[right]), reason });
  }
  const selected: NormalizedJob[] = [], displacements: Array<{ displacedId: string; selectedId: string; edgeReason: DuplicateEdgeReason }> = [];
  for (const candidate of [...records].sort(compareRecordQuality)) {
    const candidateId = stableNormalizedJobId(candidate);
    const conflict = selected.map((kept) => ({ kept, edge: edges.find((edge) => [edge.leftId, edge.rightId].includes(candidateId) && [edge.leftId, edge.rightId].includes(stableNormalizedJobId(kept))) })).find((item) => item.edge);
    if (!conflict?.edge) selected.push(candidate);
    else displacements.push({ displacedId: candidateId, selectedId: stableNormalizedJobId(conflict.kept), edgeReason: conflict.edge.reason });
  }
  return { selected, edges: edges.sort((a, b) => `${a.leftId}/${a.rightId}`.localeCompare(`${b.leftId}/${b.rightId}`)), displacements, version: DEDUPLICATION_POLICY_VERSION };
}

export function assertPairwiseIndependent(jobs: readonly NormalizedJob[]) {
  for (let left = 0; left < jobs.length; left += 1) for (let right = left + 1; right < jobs.length; right += 1) if (duplicateEdgeReason(jobs[left], jobs[right])) throw new Error("release_duplicate_pair");
  return true;
}
