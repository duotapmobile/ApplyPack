import "server-only";
import type { Database } from "@/lib/database.types";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Tables = Database["public"]["Tables"];
export type FeasibilityQueueRequest = Pick<Tables["ap_feasibility_requests"]["Row"],
  "id" | "snapshot_id" | "state" | "created_at" | "updated_at" | "error_code" | "completed_assessment_id">;
export type FeasibilityQueueSnapshot = Pick<Tables["ap_intake_snapshots"]["Row"],
  "id" | "access_email_normalized" | "desired_activities" | "search_breadth" | "guidance_requested" |
  "work_modes" | "preferred_work_mode" | "us_state_or_dc" | "employment_types" | "preferred_employment_type" |
  "benefits" | "work_condition_preferences" | "dealbreakers" | "employer_unknown_policy" |
  "salary_hard_minimum_cents" | "salary_period">;
export type FeasibilityQueueAssessment = Pick<Tables["ap_feasibility_assessments"]["Row"],
  "id" | "snapshot_id" | "state" | "outcome" | "resolution_blocker" | "reasons" |
  "preliminarily_deliverable_count" | "invalidated_at" | "expires_at">;
export type FeasibilityQueue = {
  requests: FeasibilityQueueRequest[];
  snapshots: FeasibilityQueueSnapshot[];
  assessments: FeasibilityQueueAssessment[];
  unavailable: boolean;
  page: number;
  hasMore: boolean;
  checkedAt: number;
};

export const FEASIBILITY_QUEUE_PAGE_SIZE = 50;

export function feasibilityQueuePage(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,6}$/u.test(value)) return 1;
  return Number(value);
}

export async function loadFeasibilityQueue(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, requestedPage: unknown,
): Promise<FeasibilityQueue> {
  const page = feasibilityQueuePage(requestedPage);
  const empty: FeasibilityQueue = { requests: [], snapshots: [], assessments: [], unavailable: false, page, hasMore: false, checkedAt: Date.now() };
  try {
    const offset = (page - 1) * FEASIBILITY_QUEUE_PAGE_SIZE;
    // Completed shortages and errors must remain visible after leaving PENDING.
    const requestsResult = await admin.from("ap_feasibility_requests")
      .select("id,snapshot_id,state,created_at,updated_at,error_code,completed_assessment_id")
      .neq("state", "STALE").order("created_at").order("id")
      .range(offset, offset + FEASIBILITY_QUEUE_PAGE_SIZE).returns<FeasibilityQueueRequest[]>();
    if (requestsResult.error || !requestsResult.data) return { ...empty, unavailable: true };
    const requests = requestsResult.data.slice(0, FEASIBILITY_QUEUE_PAGE_SIZE);
    const hasMore = requestsResult.data.length > FEASIBILITY_QUEUE_PAGE_SIZE;
    if (!requests.length) return empty;
    const snapshotIds = [...new Set(requests.map((request) => request.snapshot_id))];
    const assessmentIds = [...new Set(requests.flatMap((request) => request.completed_assessment_id ? [request.completed_assessment_id] : []))];
    const [snapshotsResult, assessmentsResult] = await Promise.all([
      admin.from("ap_intake_snapshots")
        .select("id,access_email_normalized,desired_activities,search_breadth,guidance_requested,work_modes,preferred_work_mode,us_state_or_dc,employment_types,preferred_employment_type,benefits,work_condition_preferences,dealbreakers,employer_unknown_policy,salary_hard_minimum_cents,salary_period")
        .in("id", snapshotIds).returns<FeasibilityQueueSnapshot[]>(),
      assessmentIds.length ? admin.from("ap_feasibility_assessments")
        .select("id,snapshot_id,state,outcome,resolution_blocker,reasons,preliminarily_deliverable_count,invalidated_at,expires_at")
        .in("id", assessmentIds).returns<FeasibilityQueueAssessment[]>()
        : Promise.resolve({ data: [] as FeasibilityQueueAssessment[], error: null }),
    ]);
    if (snapshotsResult.error || assessmentsResult.error || !snapshotsResult.data || !assessmentsResult.data) return { ...empty, unavailable: true };
    return { ...empty, requests, snapshots: snapshotsResult.data, assessments: assessmentsResult.data, page, hasMore };
  } catch {
    return { ...empty, unavailable: true };
  }
}
