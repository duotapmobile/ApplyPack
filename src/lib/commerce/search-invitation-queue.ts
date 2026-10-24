import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type SearchInvitationCandidate = {
  draftId: string;
  snapshotId: string;
  assessmentId: string;
  email: string;
  direction: string;
  requirements: string;
  eligibleJobs: number;
  assessmentExpiresAt: string;
  activeInvitationExpiresAt: string | null;
};

type Draft = { id: string; finalized_snapshot_id: string | null };
type Assessment = { id: string; snapshot_id: string; state: string; outcome: string | null;
  resolution_blocker: string; invalidated_at: string | null; expires_at: string | null;
  preliminarily_deliverable_count: number | null };
type Snapshot = { id: string; access_email_normalized: string; desired_activities: unknown;
  work_modes: unknown; us_state_or_dc: string | null; employment_types: unknown };
type Invitation = { draft_id: string; expires_at: string };

const list = (value: unknown) => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase().replaceAll("_", " ")).join(", ") : "";

export async function loadSearchInvitationQueue(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  now = new Date(),
): Promise<{ candidates: SearchInvitationCandidate[]; unavailable: boolean }> {
  const unavailable = { candidates: [], unavailable: true };
  const draftResult = await admin.from("ap_anonymous_drafts")
    .select("id,finalized_snapshot_id").eq("state", "COMPLETE")
    .is("converted_customer_id", null).gt("expires_at", now.toISOString())
    .order("updated_at").limit(100).returns<Draft[]>();
  if (draftResult.error) return unavailable;
  const drafts = draftResult.data || [];
  const snapshotIds = drafts.flatMap((draft) => draft.finalized_snapshot_id ? [draft.finalized_snapshot_id] : []);
  if (!snapshotIds.length) return { candidates: [], unavailable: false };
  const [assessmentResult, snapshotResult, invitationResult] = await Promise.all([
    admin.from("ap_feasibility_assessments")
      .select("id,snapshot_id,state,outcome,resolution_blocker,invalidated_at,expires_at,preliminarily_deliverable_count")
      .in("snapshot_id", snapshotIds).order("created_at", { ascending: false }).limit(1000).returns<Assessment[]>(),
    admin.from("ap_intake_snapshots")
      .select("id,access_email_normalized,desired_activities,work_modes,us_state_or_dc,employment_types")
      .in("id", snapshotIds).returns<Snapshot[]>(),
    admin.from("ap_search_checkout_invitations").select("draft_id,expires_at")
      .in("draft_id", drafts.map((draft) => draft.id)).is("revoked_at", null)
      .gt("expires_at", now.toISOString()).order("expires_at", { ascending: false }).returns<Invitation[]>(),
  ]);
  if (assessmentResult.error || snapshotResult.error || invitationResult.error
    || (assessmentResult.data?.length || 0) >= 1000) return unavailable;
  const latest = new Map<string, Assessment>();
  for (const assessment of assessmentResult.data || []) {
    if (!latest.has(assessment.snapshot_id)) latest.set(assessment.snapshot_id, assessment);
  }
  const snapshots = new Map((snapshotResult.data || []).map((snapshot) => [snapshot.id, snapshot]));
  const candidates: SearchInvitationCandidate[] = [];
  for (const draft of drafts) {
    const assessment = latest.get(draft.finalized_snapshot_id || "");
    const snapshot = snapshots.get(draft.finalized_snapshot_id || "");
    if (!snapshot || !assessment || assessment.state !== "COMPLETE" || assessment.outcome !== "LIKELY"
      || assessment.resolution_blocker !== "NONE" || assessment.invalidated_at || !assessment.expires_at
      || !Number.isFinite(Date.parse(assessment.expires_at)) || Date.parse(assessment.expires_at) <= now.getTime()
      || (assessment.preliminarily_deliverable_count || 0) < 10) continue;
    candidates.push({
      draftId: draft.id, snapshotId: snapshot.id, assessmentId: assessment.id,
      email: snapshot.access_email_normalized, direction: list(snapshot.desired_activities) || "Review intake direction",
      requirements: [list(snapshot.work_modes), snapshot.us_state_or_dc, list(snapshot.employment_types)].filter(Boolean).join(" · "),
      eligibleJobs: assessment.preliminarily_deliverable_count!, assessmentExpiresAt: assessment.expires_at,
      activeInvitationExpiresAt: invitationResult.data?.find((invitation) => invitation.draft_id === draft.id)?.expires_at || null,
    });
  }
  return { candidates, unavailable: false };
}
