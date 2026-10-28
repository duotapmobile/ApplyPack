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
    if (url.origin !== "https://api.stripe.com" || url.username || url.password || url.hash) throw new Error("fictional_stripe_origin_rejected");
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
      const priceId = data.get("line_items[0][price]"), quantityText = data.get("line_items[0][quantity]");
      const pack = priceId === "price_fictional_pack", quantity = Number(quantityText);
      // A modeled response must not conceal an extra tax, discount, shipping,
      // adjustable quantity, or payment-method option in the actual request.
      const allowedParameters = new Set(["mode", "line_items[0][price]", "line_items[0][quantity]", "expires_at",
        "customer_email", "success_url", "cancel_url", "automatic_tax[enabled]", "payment_method_types[0]",
        "metadata[initiation_id]", "metadata[product_kind]", "metadata[contract_version]",
        ...(pack ? ["metadata[checkout_intent_id]"] : ["metadata[checkout_attempt_id]", "metadata[quote_id]"])]);
      if (data.get("mode") !== "payment" || (!pack && priceId !== "price_fictional_search")
        || !quantityText || !/^[1-9][0-9]?$/u.test(quantityText) || quantity > (pack ? 10 : 1)
        || data.get("automatic_tax[enabled]") !== "false" || data.get("payment_method_types[0]") !== "card"
        || [...data.keys()].some(name => !allowedParameters.has(name) || data.getAll(name).length !== 1)
        || ["mode", "line_items[0][quantity]", "line_items[0][price]", "expires_at"].some(name => data.getAll(name).length !== 1))
        throw new Error("fictional_checkout_total_invalid");
      const metadata: Record<string, string> = {};
      for (const [name, value] of data) { const field = /^metadata\[([a-z_]+)\]$/u.exec(name); if (field) metadata[field[1]] = value; }
      const binding = pack ? "checkout_intent_id" : "checkout_attempt_id";
      if (!metadata.initiation_id || !metadata[binding] || (pack ? Boolean(metadata.checkout_attempt_id) : Boolean(metadata.checkout_intent_id))
        || metadata.product_kind !== (pack ? "apply_pack" : "job_search")
        || metadata.contract_version !== (pack ? "manual-launch-pack-v2" : "manual-launch-search-v2"))
        throw new Error("fictional_checkout_binding_missing");
      const price = catalog(priceId!), amount = price.unit_amount * quantity;
      const id = `cs_test_FictionalPaid${pack ? "Pack" : "Search"}${sessions.size + 1}`;
      const session: Session = { id, object: "checkout.session", mode: "payment", status: "open", payment_status: "unpaid", amount_total: amount,
        currency: "usd", expires_at: Number(data.get("expires_at")), url: `https://checkout.stripe.com/c/pay/${id}`,
        customer_email: data.get("customer_email") || "", metadata, customer_details: null, payment_intent: null,
        line_items: { data: [{ id: `li_${id}`, quantity, price }] } };
      if (!Number.isInteger(session.expires_at) || session.expires_at <= 0) throw new Error("fictional_checkout_binding_missing");
      sessions.set(id, session); commands.set(key, { body, sessionId: id }); return response(session);
    }
    const sessionId = url.pathname.slice("/v1/checkout/sessions/".length), session = sessions.get(sessionId);
    if (request.method === "GET" && url.pathname.startsWith("/v1/checkout/sessions/") && session) return response(session);
    throw new Error(`fictional_stripe_request_rejected:${request.method}:${url.pathname}`);
  };
  const complete = (id: string) => {
    const session = sessions.get(id); if (!session) throw new Error("fictional_session_missing");
    if (session.payment_intent) return structuredClone(session);
    session.status = "complete"; session.payment_status = "paid"; session.customer_details = { email: session.customer_email };
    session.payment_intent = { id: `pi_${id}`, object: "payment_intent", status: "succeeded", amount: session.amount_total, amount_received: session.amount_total,
      currency: "usd", capture_method: "automatic", amount_capturable: 0, payment_method_types: ["card"],
      latest_charge: { id: `ch_${id}`, object: "charge", status: "succeeded", paid: true, created: Math.floor(Date.now() / 1000),
        amount: session.amount_total, currency: "usd", payment_method_details: { type: "card" }, billing_details: { email: session.customer_email } } };
    return structuredClone(session);
  };
  return { fetch, complete, sessions, commands, requests };
}
