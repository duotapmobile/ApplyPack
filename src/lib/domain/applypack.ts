export const SEARCH_PRICE_CENTS = 2_000;
export const APPLY_PACK_PRICE_CENTS = 800;
export const TURNAROUND_HOURS = 24;

export const searchOrderStatuses = [
  "draft",
  "payment_pending",
  "ready_for_research",
  "researching",
  "selecting_matches",
  "quality_review",
  "ready_to_deliver",
  "delivered",
  "replacement_requested",
  "completed",
  "cancelled",
  "refunded",
] as const;

export type SearchOrderStatus = (typeof searchOrderStatuses)[number];

export const applyPackOrderStatuses = [
  "draft",
  "payment_pending",
  "ready_to_draft",
  "resume_drafting",
  "cover_letter_drafting",
  "quality_review",
  "ready_to_deliver",
  "delivered",
  "correction_requested",
  "completed",
  "cancelled",
  "refunded",
] as const;

export type ApplyPackOrderStatus = (typeof applyPackOrderStatuses)[number];

export function calculateApplyPackTotal(selectedJobIds: readonly string[]): number {
  return new Set(selectedJobIds).size * APPLY_PACK_PRICE_CENTS;
}

export function calculateDueAt(workReadyAt: Date): Date {
  return new Date(workReadyAt.getTime() + TURNAROUND_HOURS * 60 * 60 * 1_000);
}

export function availableCapacity(args: {
  maximum: number;
  committed: number;
  reserved: number;
}): number {
  return Math.max(0, args.maximum - args.committed - args.reserved);
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}
