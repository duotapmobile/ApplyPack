import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609030021_nonrecursive_job_read_policies.sql"),
  "utf8",
).replace(/\s+/g, " ");

describe("customer job read policies", () => {
  it("uses non-recursive security-definer predicates", () => {
    expect(sql).toContain("create or replace function public.can_view_delivered_job(p_job_id uuid)");
    expect(sql).toContain("create or replace function public.can_view_delivered_job_match(p_match_id uuid)");
    expect(sql.match(/security definer/g)).toHaveLength(2);
    expect(sql).toContain("using (public.is_admin() or public.can_view_delivered_job(id))");
    expect(sql).toContain("using (public.is_admin() or public.can_view_delivered_job_match(id))");
  });

  it("keeps delivered-order ownership and the permanent Liveops exclusion inside both predicates", () => {
    expect(sql.match(/order_row.customer_id = auth.uid\(\)/g)).toHaveLength(2);
    expect(sql.match(/order_row.status = 'delivered'/g)).toHaveLength(2);
    expect(sql.match(/not like '%liveops%'/g)).toHaveLength(2);
    expect(sql.match(/rejection_reason is distinct from 'hard_exclusion'/g)).toHaveLength(2);
  });

  it("does not expose the policy helpers to anonymous callers", () => {
    expect(sql).toContain("revoke all on function public.can_view_delivered_job(uuid) from public, anon");
    expect(sql).toContain("revoke all on function public.can_view_delivered_job_match(uuid) from public, anon");
    expect(sql).toContain("grant execute on function public.can_view_delivered_job(uuid) to authenticated, service_role");
  });
});
