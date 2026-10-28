import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { preparedSourceOutcome } from "@/lib/matching/research-preparation-review";
const now = new Date("2026-10-26T12:00:00Z");
const complete = { status: "succeeded", enumeration_status: "complete", completed_at: "2026-10-26T11:59:00+00:00", fetched_count: 0, checkpoint_start: null };
it("distinguishes no capture from a reviewed-capable empty complete capture", () => {
  expect(preparedSourceOutcome(null, now)).toEqual({ state: "WAITING", observedCount: null });
  expect(preparedSourceOutcome(complete, now)).toEqual({ state: "EMPTY", observedCount: 0 });
  expect(preparedSourceOutcome({ ...complete, fetched_count: 2 }, now)).toEqual({ state: "COMPLETE", observedCount: 2 });
});
it.each([
  [{ status: "partial", enumeration_status: "partial" }, "PARTIAL"],
  [{ status: "link_only", enumeration_status: null }, "PARTIAL"],
  [{ enumeration_status: "failed" }, "PARTIAL"],
  [{ checkpoint_start: { cursor: "page2" } }, "PARTIAL"],
  [{ completed_at: null }, "PARTIAL"],
  [{ status: "failed" }, "FAILED"],
  [{ status: "rate_limited" }, "RATE_LIMITED"],
  [{ status: "started", completed_at: null }, "WAITING"],
  [{ completed_at: "2026-10-25T11:59:59Z" }, "STALE"],
  [{ completed_at: "2026-10-26T12:00:01Z" }, "STALE"],
])("never treats partial, failed or stale capture %j as empty", (change, state) => {
  expect(preparedSourceOutcome({ ...complete, ...change }, now).state).toBe(state);
});
it.each([{ ...complete, fetched_count: -1 }, { ...complete, status: "made_up" }, { ...complete, completed_at: "tomorrow" }, {}])("rejects malformed progress %j", raw => {
  expect(() => preparedSourceOutcome(raw, now)).toThrow();
});
