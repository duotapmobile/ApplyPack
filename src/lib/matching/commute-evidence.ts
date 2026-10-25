import { z } from "zod";

export const COMMUTE_EVIDENCE_VERSION = "reviewed-commute-v1";
export const COMMUTE_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const httpsUrl = z.string().trim().max(2000).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use an HTTPS route source without embedded credentials.");

// The reviewer supplies observations, never the immutable subject bindings.
export const commuteObservationSchema = z.object({
  destinationNodeId: z.string().uuid(),
  destination: z.string().trim().min(6).max(500),
  destinationPrecision: z.enum(["STREET_ADDRESS", "NAMED_WORKSITE"]),
  method: z.enum(["DRIVE", "TRANSIT", "WALK", "BICYCLE"]),
  oneWayMiles: z.number().finite().positive().max(1000),
  oneWayMinutes: z.number().finite().positive().max(1440),
  routeSourceUrl: httpsUrl,
  checkedAt: z.string().datetime({ offset: true }),
  routeNotes: z.string().trim().min(10).max(1000),
  reviewedOriginArea: z.literal(true),
  reviewedExactWorksite: z.literal(true),
}).strict();
export type CommuteObservation = z.infer<typeof commuteObservationSchema>;

const boundSchema = commuteObservationSchema.extend({
  version: z.literal(COMMUTE_EVIDENCE_VERSION),
  snapshotId: z.string().uuid(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  jobSnapshotId: z.string().uuid(), jobHash: z.string().regex(/^[a-f0-9]{64}$/u),
  originZip: z.string().regex(/^\d{5}$/u), maximumMiles: z.number().finite().positive().max(1000),
  destinationSourceLocator: z.string().min(1), destinationSourceExcerpt: z.string().min(1),
  reviewerId: z.string().uuid(), reviewedAt: z.string().datetime({ offset: true }),
}).strict();
export type BoundCommuteEvidence = z.infer<typeof boundSchema>;
type Snapshot = { id: string; content_sha256: string; travel: unknown; commute_distance_miles?: number | null };
type Job = { id: string; content_sha256: string };
type Node = { id: string; source_locator: string | null; source_excerpt: string | null; typed_value: unknown };

export function commuteOrigin(snapshot: Pick<Snapshot, "travel" | "commute_distance_miles">) {
  const travel = record(snapshot.travel);
  const maximumMiles = snapshot.commute_distance_miles ?? travel.commuteDistanceMiles;
  return {
    zip: typeof travel.zipCode === "string" && /^\d{5}$/u.test(travel.zipCode) ? travel.zipCode : null,
    maximumMiles: typeof maximumMiles === "number" && Number.isFinite(maximumMiles) && maximumMiles > 0 && maximumMiles <= 1000 ? maximumMiles : null,
  };
}

export function commuteGateKey(snapshot: Pick<Snapshot, "travel" | "commute_distance_miles">) {
  const { maximumMiles } = commuteOrigin(snapshot);
  return maximumMiles == null ? "customer:commute" : `customer:commute:${maximumMiles}-miles`;
}

export function commuteDestinationNode(node: Node) {
  return Boolean(node.source_locator && node.source_excerpt && ["WORK_MODE", "GEOGRAPHY", "COMMUTE"].includes(String(record(node.typed_value).kind)));
}

function fresh(checkedAt: string, reviewedAt: string, now: number) {
  const checked = Date.parse(checkedAt), reviewed = Date.parse(reviewedAt);
  return checked <= reviewed && reviewed <= now && checked >= now - COMMUTE_EVIDENCE_MAX_AGE_MS;
}

export function bindCommuteEvidence(input: { observation: CommuteObservation; snapshot: Snapshot; job: Job; nodes: readonly Node[]; reviewerId: string; reviewedAt: string }) {
  const observation = commuteObservationSchema.parse(input.observation);
  const origin = commuteOrigin(input.snapshot);
  const node = input.nodes.find((item) => item.id === observation.destinationNodeId);
  if (!origin.zip || origin.maximumMiles == null) throw new Error("commute_confirmed_origin_and_limit_required");
  if (!node || !commuteDestinationNode(node) || !node.source_excerpt!.includes(observation.destination)) throw new Error("commute_exact_employer_destination_required");
  if (!fresh(observation.checkedAt, input.reviewedAt, Date.parse(input.reviewedAt))) throw new Error("commute_route_check_stale_or_future");
  return boundSchema.parse({ ...observation, version: COMMUTE_EVIDENCE_VERSION,
    snapshotId: input.snapshot.id, snapshotHash: input.snapshot.content_sha256,
    jobSnapshotId: input.job.id, jobHash: input.job.content_sha256,
    originZip: origin.zip, maximumMiles: origin.maximumMiles,
    destinationSourceLocator: node.source_locator, destinationSourceExcerpt: node.source_excerpt,
    reviewerId: input.reviewerId, reviewedAt: input.reviewedAt });
}

export function reviewedCommuteResult(input: { evidence: unknown; snapshot: Snapshot; job: Job; nodes: readonly Node[]; reviewerId: string; now?: number }) {
  const parsed = boundSchema.safeParse(input.evidence);
  if (!parsed.success) return null;
  const evidence = parsed.data, origin = commuteOrigin(input.snapshot);
  const node = input.nodes.find((item) => item.id === evidence.destinationNodeId);
  if (evidence.snapshotId !== input.snapshot.id || evidence.snapshotHash !== input.snapshot.content_sha256
    || evidence.jobSnapshotId !== input.job.id || evidence.jobHash !== input.job.content_sha256
    || evidence.originZip !== origin.zip || evidence.maximumMiles !== origin.maximumMiles
    || evidence.reviewerId !== input.reviewerId || !node || !commuteDestinationNode(node)
    || evidence.destinationSourceLocator !== node.source_locator || evidence.destinationSourceExcerpt !== node.source_excerpt
    || !node.source_excerpt!.includes(evidence.destination) || !fresh(evidence.checkedAt, evidence.reviewedAt, input.now ?? Date.now())) return null;
  return evidence.oneWayMiles <= evidence.maximumMiles ? "PASS" as const : "FAIL" as const;
}
