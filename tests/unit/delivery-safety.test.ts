import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const search = readFileSync(resolve(process.cwd(), "src/app/api/checkout/search/route.ts"), "utf8");
const apply = readFileSync(resolve(process.cwd(), "src/app/api/checkout/apply-packs/route.ts"), "utf8");
const delivery = readFileSync(resolve(process.cwd(), "src/app/api/admin/apply-pack-items/[id]/deliver/route.ts"), "utf8");
const correction = readFileSync(resolve(process.cwd(), "src/app/api/admin/corrections/[id]/resolve/route.ts"), "utf8");
const maintenance = readFileSync(resolve(process.cwd(), "src/app/api/cron/maintenance/route.ts"), "utf8");

describe("payment metadata and delivered-file safety", () => {
  it("keeps customer, intake, and job identifiers out of Stripe metadata", () => {
    const searchMetadata = search.slice(search.indexOf("metadata:"), search.indexOf("},\n    },", search.indexOf("metadata:")));
    const applyMetadata = apply.slice(apply.indexOf("metadata:"), apply.indexOf("},\n    },", apply.indexOf("metadata:")));
    expect(searchMetadata).not.toMatch(/customer_id|intake_id/);
    expect(applyMetadata).not.toMatch(/customer_id|search_order_id|job_match_ids/);
  });

  it("scans both original and corrected delivery files before private storage", () => {
    expect(delivery.indexOf("const scans = await Promise.all(reviewedFiles.map")).toBeLessThan(delivery.indexOf('storage.from("customer-deliveries").upload'));
    expect(correction.indexOf("const scans = await Promise.all(reviewedFiles.map")).toBeLessThan(correction.indexOf('storage.from("customer-deliveries").upload'));
  });

  it("uses a compare-and-set delivery claim and recovers abandoned claims", () => {
    expect(delivery).toContain('status: "delivery_processing"');
    expect(delivery).toContain('.eq("status", priorStatus)');
    expect(maintenance).toContain('.eq("status", "delivery_processing")');
    expect(maintenance).toContain("15 * 60_000");
  });
});
