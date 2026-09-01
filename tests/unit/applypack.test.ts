import { describe, expect, it } from "vitest";

import {
  APPLY_PACK_PRICE_CENTS,
  SEARCH_PRICE_CENTS,
  availableCapacity,
  calculateApplyPackTotal,
  calculateDueAt,
} from "@/lib/domain/applypack";

describe("ApplyPack product invariants", () => {
  it("keeps the locked prices", () => {
    expect(SEARCH_PRICE_CENTS).toBe(2_000);
    expect(APPLY_PACK_PRICE_CENTS).toBe(800);
  });

  it("charges once per unique selected job", () => {
    expect(calculateApplyPackTotal(["a", "b", "c"])).toBe(2_400);
    expect(calculateApplyPackTotal(["a", "a", "b"])).toBe(1_600);
  });

  it("sets a fixed deadline exactly 24 hours later", () => {
    const ready = new Date("2026-11-01T05:30:00.000Z");
    expect(calculateDueAt(ready).toISOString()).toBe(
      "2026-11-02T05:30:00.000Z",
    );
  });

  it("never reports negative capacity", () => {
    expect(availableCapacity({ maximum: 2, committed: 1, reserved: 1 })).toBe(0);
    expect(availableCapacity({ maximum: 2, committed: 3, reserved: 1 })).toBe(0);
  });
});
