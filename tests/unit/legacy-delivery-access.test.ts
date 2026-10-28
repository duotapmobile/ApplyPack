// @vitest-environment node
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), getClaims: vi.fn(), from: vi.fn(), rpc: vi.fn(), download: vi.fn(), createSignedUrl: vi.fn(), extract: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: mocks.getUser,
  getSession: async () => ({ data: { session: { access_token: "untrusted-cookie" } } }),
  getClaims: mocks.getClaims,
} }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({
  from: mocks.from, rpc: mocks.rpc, storage: { from: () => ({ download: mocks.download, createSignedUrl: mocks.createSignedUrl }) },
}) }));
vi.mock("@/lib/files/isolated-extraction", () => ({ extractIsolatedDocument: mocks.extract }));
import { GET } from "@/app/api/customer/deliveries/[id]/route";
import { legacyDeliveryPath, type LegacyDeliveryRevision } from "@/lib/materials/legacy-delivery";
import { safeAuthDestination } from "@/lib/auth/email-code";

const customerId = "10000000-0000-4000-8000-000000000001";
const orderId = "10000000-0000-4000-8000-000000000002";
const itemId = "10000000-0000-4000-8000-000000000003";
const revisionId = "10000000-0000-4000-8000-000000000004";
const reviewerId = "10000000-0000-4000-8000-000000000005";
const correctionId = "10000000-0000-4000-8000-000000000006";
const deliveredAt = "2026-09-01T12:00:00Z";
const base = `${customerId}/orders/${orderId}/items/${itemId}`;
const initialRevision: LegacyDeliveryRevision = { id: revisionId, apply_pack_item_id: itemId, version: 1,
  correction_request_id: null, resume_path: `${base}/resume.docx`, cover_letter_path: `${base}/cover-letter.docx`,
  delivered_at: deliveredAt, reviewed_by: reviewerId };
let item: Record<string, unknown>;
let revisions: LegacyDeliveryRevision[];
const queryCalls: Array<[string, string, ...unknown[]]> = [];
const request = (query = "kind=resume") => GET(new Request(`https://example.test/api/customer/deliveries/${itemId}?${query}`), { params: Promise.resolve({ id: itemId }) });
afterEach(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.clearAllMocks(); queryCalls.length = 0;
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  item = { id: itemId, order_id: orderId, status: "delivered", delivered_at: deliveredAt,
    orders: { customer_id: customerId, product_kind: "apply_pack" } };
  revisions = [{ ...initialRevision }];
  mocks.getUser.mockResolvedValue({ data: { user: { id: customerId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: customerId,
    amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) - 60 }] } }, error: null });
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) query[method] = (...args: unknown[]) => {
      queryCalls.push([table, method, ...args]);
      if (method === "eq") filters[String(args[0])] = args[1];
      return query;
    };
    query.maybeSingle = () => Promise.resolve({ data: item, error: null });
    query.returns = () => Promise.resolve({ data: revisions.filter((row) => Object.entries(filters).every(([key, value]) => row[key as keyof LegacyDeliveryRevision] === value)), error: null });
    return query;
  });
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>"); zip.file("_rels/.rels", "<Relationships/>");
  zip.file("word/document.xml", "<document>Historical reviewed content</document>");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(bytes)]), error: null });
  mocks.extract.mockResolvedValue({ text: "Historical reviewed content", pageCount: null, paginationStatus: "UNKNOWN" });
  mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.example.test/private-signed-file" }, error: null });
});

describe("historical customer document access", () => {
  it("does not allow a new-policy projection to bypass the current delivery access window", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await request()).status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_legacy_delivery_access_allowed", { p_item_id: itemId, p_customer_id: customerId });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
  it("opens the reviewed owned revision only after isolated safety inspection", async () => {
    const response = await request();
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.download).toHaveBeenCalledWith(initialRevision.resume_path);
    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(initialRevision.resume_path, 900, { download: "ApplyPack_resume_version_1.docx" });
    expect(queryCalls).toContainEqual(["apply_pack_delivery_revisions", "eq", "apply_pack_item_id", itemId]);
    expect(mocks.getClaims).toHaveBeenCalledWith("untrusted-cookie");
  });
  it("retains a delivered customer's access regardless of later refund status", async () => {
    item.orders = { customer_id: customerId, product_kind: "apply_pack", status: "delivered_refunded" };
    expect((await request()).status).toBe(303);
  });
  it("returns safe version metadata and supports an explicitly selected correction revision", async () => {
    revisions = [{ ...initialRevision, version: 2, correction_request_id: correctionId,
      resume_path: `${base}/corrections/${correctionId}/resume.docx`, cover_letter_path: `${base}/corrections/${correctionId}/cover-letter.docx` }];
    const history = await request("history=1");
    expect(await history.json()).toEqual({ versions: [{ id: revisionId, version: 2, deliveredAt, available: true }] });
    expect(mocks.download).not.toHaveBeenCalled();
    expect((await request(`kind=cover_letter&revisionId=${revisionId}`)).status).toBe(303);
    expect(mocks.download).toHaveBeenCalledWith(revisions[0].cover_letter_path);
    expect(queryCalls).toContainEqual(["apply_pack_delivery_revisions", "eq", "id", revisionId]);
  });
  it.each(["unauthenticated", "invalid-signature", "different-subject", "stale-authentication", "refresh-only"])("rejects %s before reading records", async (failure) => {
    if (failure === "unauthenticated") mocks.getUser.mockResolvedValue({ data: { user: null } });
    else if (failure === "invalid-signature") mocks.getClaims.mockResolvedValue({ error: { message: "invalid" } });
    else mocks.getClaims.mockResolvedValue({ data: { claims: {
      sub: failure === "different-subject" ? reviewerId : customerId,
      amr: [{ method: failure === "refresh-only" ? "token_refresh" : "otp", timestamp: Math.floor(Date.now() / 1000) - (failure === "stale-authentication" ? 3600 : 60) }],
    } }, error: null });
    expect((await request()).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
  it("sends an expired browser session to sign-in with a safe return to the same delivery", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: customerId,
      amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) - 3600 }] } }, error: null });
    const response = await GET(new Request(`https://internal-host.invalid/api/customer/deliveries/${itemId}?kind=resume`, {
      headers: { accept: "text/html,application/xhtml+xml" },
    }), { params: Promise.resolve({ id: itemId }) });
    expect(response.status).toBe(303);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.origin).toBe("https://example.test");
    expect(destination.pathname).toBe("/sign-in");
    expect(safeAuthDestination(destination.searchParams.get("next"))).toBe(`/my-applypack#historical-delivery-${itemId}`);
    expect(mocks.download).not.toHaveBeenCalled();
    // After verified fresh authentication, the returned portal's same download succeeds.
    expect((await request()).status).toBe(303);
    vi.unstubAllEnvs();
  });
  it.each(["wrong-owner", "undelivered", "wrong-product"])("rejects %s before reading private file storage", async (failure) => {
    if (failure === "wrong-owner") item.orders = { customer_id: reviewerId, product_kind: "apply_pack" };
    if (failure === "wrong-product") item.orders = { customer_id: customerId, product_kind: "search" };
    if (failure === "undelivered") item.delivered_at = null;
    expect((await request()).status).toBe(404);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it.each([
    { reviewed_by: null }, { resume_path: `other-customer/orders/${orderId}/items/${itemId}/resume.docx` },
    { resume_path: `${base}/../resume.docx` }, { cover_letter_path: `${base}/%2e%2e/cover-letter.docx` },
    { resume_path: `https://external.example/resume.docx` }, { correction_request_id: correctionId },
    { delivered_at: "2999-01-01T00:00:00Z" },
  ])("rejects unsafe or unreviewed legacy records: %j", async (change) => {
    revisions[0] = { ...initialRevision, ...change };
    expect((await request()).status).toBe(409);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
  it("does not expose another item's selected revision", async () => {
    revisions[0].apply_pack_item_id = reviewerId;
    expect((await request(`kind=resume&revisionId=${revisionId}`)).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("rejects malformed DOCX content without invoking extraction or signing", async () => {
    mocks.download.mockResolvedValue({ data: new Blob(["not a DOCX"]), error: null });
    expect((await request()).status).toBe(409);
    expect(mocks.extract).not.toHaveBeenCalled(); expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
  it("rejects oversized stored objects before allocating file bytes", async () => {
    const arrayBuffer = vi.fn(); mocks.download.mockResolvedValue({ data: { size: 10 * 1024 * 1024 + 1, arrayBuffer }, error: null });
    expect((await request()).status).toBe(409); expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it("preserves records and returns a safe error when storage or inspection is unavailable", async () => {
    mocks.download.mockResolvedValueOnce({ data: null, error: { message: initialRevision.resume_path } });
    const missing = await request(); expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain(customerId);
    mocks.extract.mockRejectedValueOnce(new Error("private worker diagnostic"));
    const unsafe = await request(); expect(unsafe.status).toBe(503);
    expect(await unsafe.text()).not.toContain("private worker diagnostic");
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("historical path binding", () => {
  it("requires the revision to belong to the exact item and expected owner path", () => {
    expect(legacyDeliveryPath({ customerId, orderId, itemId, revision: initialRevision, kind: "resume" })).toBe(initialRevision.resume_path);
    expect(legacyDeliveryPath({ customerId, orderId, itemId: reviewerId, revision: initialRevision, kind: "resume" })).toBeNull();
  });
});
