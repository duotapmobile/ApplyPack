import { canonicalSha256, type SearchBreadth } from "@/lib/domain/foundation";
import { buildResponsibilityFirstQueries, type ResponsibilityEvidence } from "./retrieval";

export function researchFamilies(snapshot: Record<string, unknown>, facts: readonly Record<string, unknown>[], round: number) {
  if (!Number.isInteger(round) || round < 1 || round > 3) throw new Error("research_round_out_of_bounds");
  const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const breadth = snapshot.search_breadth as SearchBreadth;
  if (!["CLOSE_TO_PREVIOUS_WORK", "ADJACENT_OPPORTUNITIES", "BROADEST_SUPPORTED_SCOPE"].includes(breadth)) throw new Error("research_breadth_required");
  const verifiedResponsibilities: ResponsibilityEvidence[] = facts.filter(f => !f.superseded_at
    && f.snapshot_id === snapshot.id
    && (f.verification === "CUSTOMER_CONFIRMED" || (f.verification === "HUMAN_VERIFIED" && f.source_kind === "HUMAN_VERIFICATION" && !!f.supplied_source_id))
    && f.value_kind === "RESPONSIBILITY").map(f => ({
    id: String(f.id), label: String((f.typed_value as Record<string, unknown>)?.activity || (f.typed_value as Record<string, unknown>)?.responsibility || f.semantic_key), relation: "DIRECT", verified: true,
    // Expansion families must be recorded evidence, never generated job-title guesses.
    nearbyRoleFamilies: strings((f.typed_value as Record<string, unknown>)?.nearbyRoleFamilies),
    relatedRoleFamilies: strings((f.typed_value as Record<string, unknown>)?.relatedRoleFamilies),
    broadRoleFamilies: strings((f.typed_value as Record<string, unknown>)?.broadRoleFamilies),
  }));
  const allowed = round === 1 ? "CLOSE_TO_PREVIOUS_WORK" : round === 2 && breadth === "BROADEST_SUPPORTED_SCOPE" ? "ADJACENT_OPPORTUNITIES" : breadth;
  const families = buildResponsibilityFirstQueries({ breadth: allowed, desiredResponsibilities: strings(snapshot.desired_activities), verifiedResponsibilities,
    capabilities: facts.filter(f => f.snapshot_id === snapshot.id && !f.superseded_at && f.verification === "CUSTOMER_CONFIRMED" && f.capability_status === "CAN_DO_NOW").map(f => String(f.semantic_key)),
    acceptedWorkModes: strings(snapshot.work_modes), stateOrDc: String(snapshot.us_state_or_dc || ""), acceptedEmploymentTypes: strings(snapshot.employment_types),
    hardRestrictions: [...strings(snapshot.blocked_industries).map(v => `blocked industry ${v}`), ...strings(snapshot.dealbreakers),
      ...Object.entries((snapshot.work_condition_preferences || {}) as Record<string, unknown>)
        .filter(([, strength]) => strength === "DO_NOT_SHOW" || strength === "DEALBREAKER" || strength === "MUST_HAVE")
        .map(([condition, strength]) => `${strength === "MUST_HAVE" ? "require" : "exclude"} ${condition}`)],
    targetTitles: strings(snapshot.optional_titles), industryInterests: strings(snapshot.optional_industries) });
  if (!families.length || families.length > 100) throw new Error("research_responsibilities_required");
  return { families, hash: canonicalSha256({ snapshotId: snapshot.id, snapshotHash: snapshot.content_sha256, round, families }) };
}
