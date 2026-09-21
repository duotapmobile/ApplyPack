export const boardPlans = {
  weekly: { label: "Weekly", amountCents: 699, interval: "week", intervalCount: 1, priceEnvironmentKey: "STRIPE_JOB_BOARD_WEEKLY_PRICE_ID" },
  monthly: { label: "Monthly", amountCents: 1999, interval: "month", intervalCount: 1, priceEnvironmentKey: "STRIPE_JOB_BOARD_MONTHLY_PRICE_ID" },
  three_months: { label: "Three months", amountCents: 4499, interval: "month", intervalCount: 3, priceEnvironmentKey: "STRIPE_JOB_BOARD_THREE_MONTH_PRICE_ID" },
} as const;

export type BoardPlanId = keyof typeof boardPlans;

export function isBoardPlanId(value: unknown): value is BoardPlanId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(boardPlans, value);
}

export function boardPlanPriceId(planId: BoardPlanId, environment: Partial<NodeJS.ProcessEnv> = process.env) {
  const value = environment[boardPlans[planId].priceEnvironmentKey]?.trim();
  return value || null;
}

export function boardPlanDisclosure(planId: BoardPlanId) {
  const plan = boardPlans[planId];
  const renewal = plan.interval === "week" ? "every week" : plan.intervalCount === 1 ? "every calendar month" : "every three calendar months";
  return `$${(plan.amountCents / 100).toFixed(2)} charged ${renewal}; auto-renews until canceled.`;
}
