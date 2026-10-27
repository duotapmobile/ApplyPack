// External Stripe HTTP transport only. Actual SDK signatures, account/price
// validation, checkout idempotency and webhook/SQL handlers remain unmocked.
export function paidSearchProviderFixture() {
  type Session = { id: string; object: string; mode: string; status: string; payment_status: string; amount_total: number;
    currency: string; expires_at: number; url: string; customer_email: string; metadata: Record<string, string>;
    customer_details: { email: string } | null; payment_intent: Record<string, unknown> | null; line_items: { data: unknown[] } };
  const sessions = new Map<string, Session>(), commands = new Map<string, { body: string; sessionId: string }>();
  const requests: { method: string; path: string }[] = [];
  const catalog = (id: string) => {
    if (!["price_fictional_search", "price_fictional_pack"].includes(id)) throw new Error("fictional_price_unknown");
    return { id, object: "price", active: true, type: "one_time", currency: "usd", unit_amount: id === "price_fictional_search" ? 1899 : 799,
      product: { id: `prod_${id}`, object: "product", active: true, name: id === "price_fictional_search" ? "Job Match Search" : "Tailored Resume + Cover Letter" } };
  };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== "https://api.stripe.com") throw new Error("fictional_stripe_origin_rejected");
    requests.push({ method: request.method, path: url.pathname });
    const response = (value: unknown) => Response.json(value, { headers: { "request-id": `req_Fictional${requests.length}` } });
    if (request.method === "GET" && url.pathname === "/v1/account") return response({ id: "acct_FictionalPaidSearch", object: "account" });
    if (request.method === "GET" && url.pathname.startsWith("/v1/prices/")) return response(catalog(url.pathname.slice(11)));
    if (request.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const body = await request.text(), data = new URLSearchParams(body), key = request.headers.get("idempotency-key");
      if (!key) throw new Error("fictional_provider_key_missing");
      const prior = commands.get(key);
      if (prior) {
        if (body !== prior.body) throw new Error("fictional_provider_payload_changed");
        return response(sessions.get(prior.sessionId));
      }
      if (data.get("mode") !== "payment" || data.get("line_items[0][quantity]") !== "1"
        || data.get("line_items[0][price]") !== "price_fictional_search") throw new Error("fictional_checkout_total_invalid");
      const metadata: Record<string, string> = {};
      for (const [name, value] of data) { const field = /^metadata\[([a-z_]+)\]$/u.exec(name); if (field) metadata[field[1]] = value; }
      const id = `cs_test_FictionalPaidSearch${sessions.size + 1}`;
      const session: Session = { id, object: "checkout.session", mode: "payment", status: "open", payment_status: "unpaid", amount_total: 1899,
        currency: "usd", expires_at: Number(data.get("expires_at")), url: `https://checkout.stripe.com/c/pay/${id}`,
        customer_email: data.get("customer_email") || "", metadata, customer_details: null, payment_intent: null,
        line_items: { data: [{ id: "li_FictionalSearch", quantity: 1, price: catalog("price_fictional_search") }] } };
      if (!Number.isInteger(session.expires_at) || !metadata.initiation_id || !metadata.checkout_attempt_id) throw new Error("fictional_checkout_binding_missing");
      sessions.set(id, session); commands.set(key, { body, sessionId: id }); return response(session);
    }
    const sessionId = url.pathname.slice("/v1/checkout/sessions/".length), session = sessions.get(sessionId);
    if (request.method === "GET" && url.pathname.startsWith("/v1/checkout/sessions/") && session) return response(session);
    throw new Error(`fictional_stripe_request_rejected:${request.method}:${url.pathname}`);
  };
  const complete = (id: string) => {
    const session = sessions.get(id); if (!session) throw new Error("fictional_session_missing");
    session.status = "complete"; session.payment_status = "paid"; session.customer_details = { email: session.customer_email };
    session.payment_intent = { id: "pi_FictionalPaidSearch", object: "payment_intent", status: "succeeded", amount: 1899, amount_received: 1899,
      currency: "usd", capture_method: "automatic", amount_capturable: 0, payment_method_types: ["card"],
      latest_charge: { id: "ch_FictionalPaidSearch", object: "charge", status: "succeeded", paid: true, created: Math.floor(Date.now() / 1000),
        amount: 1899, currency: "usd", payment_method_details: { type: "card" }, billing_details: { email: session.customer_email } } };
    return structuredClone(session);
  };
  return { fetch, complete, sessions, commands, requests };
}
