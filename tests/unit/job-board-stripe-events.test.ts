import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { processBoardStripeEvent, reconcileBoardSubscriptions } from "@/lib/job-board/stripe-events";

vi.mock("server-only", () => ({}));

const invoice = {
  id: "in_legacy",
  amount_paid: 4_499,
  status: "paid",
  parent: { subscription_details: { subscription: "sub_legacy" } },
};

const subscription = {
  id: "sub_legacy",
  customer: "cus_legacy",
  status: "active",
  cancel_at_period_end: true,
  latest_invoice: "in_legacy",
  metadata: {
    contract_version: "paid-board-v1",
    customer_id: "1a000000-0000-4000-8000-000000000001",
    plan_id: "monthly",
  },
  items: { data: [{ quantity: 1, current_period_start: 1_700_000_000, current_period_end: 1_900_000_000 }] },
};

function stripeMock() {
  return {
    invoicePayments: { list: vi.fn().mockResolvedValue({ data: [{ invoice }] }) },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue(subscription),
      update: vi.fn(),
    },
    charges: { retrieve: vi.fn() },
  } as unknown as Stripe;
}

function terminalAdminMock() {
  const rpc = vi.fn().mockResolvedValue({ data: { accessRevoked: true }, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { id: "2a000000-0000-4000-8000-000000000001", state: "ACTIVE", refund_state: "NONE", last_provider_event_created: 900 },
    error: null,
  });
  return {
    rpc,
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }),
    }),
  };
}

describe("retired board provider ordering", () => {
  it("applies a delayed successful refund atomically instead of suppressing it behind a newer event", async () => {
    const stripe = stripeMock();
    const admin = terminalAdminMock();
    const event = {
      id: "evt_delayed_refund",
      type: "refund.updated",
      created: 100,
      data: { object: { id: "re_legacy", payment_intent: "pi_legacy", amount: 4_499, status: "succeeded" } },
    } as unknown as Stripe.Event;

    await expect(processBoardStripeEvent(stripe, admin as never, event)).resolves.toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("ap_apply_legacy_board_terminal_event", expect.objectContaining({
      p_provider_event_id: "evt_delayed_refund",
      p_provider_created: 100,
      p_resulting_state: "REFUNDED",
      p_refund_state: "FULL",
      p_provider_refund_id: "re_legacy",
    }));
  });

  it("applies a delayed dispute atomically instead of suppressing it behind a newer event", async () => {
    const stripe = stripeMock();
    const admin = terminalAdminMock();
    const event = {
      id: "evt_delayed_dispute",
      type: "charge.dispute.created",
      created: 101,
      data: { object: { id: "dp_legacy", charge: { payment_intent: "pi_legacy" }, amount: 4_499, status: "needs_response" } },
    } as unknown as Stripe.Event;

    await expect(processBoardStripeEvent(stripe, admin as never, event)).resolves.toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("ap_apply_legacy_board_terminal_event", expect.objectContaining({
      p_provider_event_id: "evt_delayed_dispute",
      p_provider_created: 101,
      p_resulting_state: "DISPUTED",
      p_provider_dispute_id: "dp_legacy",
    }));
  });

  it("uses a reconciliation-only watermark and abandons an optimistic update that races a terminal event", async () => {
    const stripe = stripeMock();
    const updatePayloads: Array<Record<string, unknown>> = [];
    const predicates: Array<[string, unknown]> = [];
    let tableCall = 0;
    const updateChain = {
      eq(field: string, value: unknown) { predicates.push([field, value]); return this; },
      is(field: string, value: unknown) { predicates.push([field, value]); return this; },
      select() { return this; },
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const admin = {
      rpc: vi.fn(),
      from: vi.fn(() => {
        tableCall += 1;
        if (tableCall === 1) {
          return { select: () => ({ order: () => ({ limit: async () => ({ data: [{ provider_subscription_id: "sub_legacy" }], error: null }) }) }) };
        }
        if (tableCall === 2) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "2a000000-0000-4000-8000-000000000001",
                    state: "ACTIVE",
                    access_ends_at: "2030-03-17T17:46:40.000Z",
                    refund_state: "NONE",
                    provider_refund_id: null,
                    provider_dispute_id: null,
                    last_provider_event_created: 900,
                    last_provider_event_id: "evt_paid",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          update: (payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            return updateChain;
          },
        };
      }),
    };

    await expect(reconcileBoardSubscriptions(stripe, admin as never)).resolves.toBe(0);
    expect(updatePayloads).toHaveLength(1);
    expect(updatePayloads[0]).toHaveProperty("last_reconciled_at");
    expect(updatePayloads[0]).not.toHaveProperty("last_provider_event_created");
    expect(updatePayloads[0]).not.toHaveProperty("last_provider_event_id");
    expect(predicates).toEqual(expect.arrayContaining([
      ["last_provider_event_created", 900],
      ["last_provider_event_id", "evt_paid"],
      ["refund_state", "NONE"],
      ["provider_dispute_id", null],
    ]));
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
