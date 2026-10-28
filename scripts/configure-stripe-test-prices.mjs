import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY || "";
if (!/^(?:sk|rk)_test_/.test(key)) {
  throw new Error("Refusing to configure prices: STRIPE_SECRET_KEY is not a Stripe test-mode key.");
}

const stripe = new Stripe(key, { appInfo: { name: "ApplyPack setup", version: "0.1.0" } });

async function ensurePrice({ lookupKey, productName, description, amount }) {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 10,
    expand: ["data.product"],
  });
  const price = existing.data[0];
  if (price) {
    if (price.livemode || price.currency !== "usd" || price.unit_amount !== amount || price.type !== "one_time") {
      throw new Error(`Existing ${lookupKey} price does not match the required test-mode amount.`);
    }
    const product =
      typeof price.product === "string" ? await stripe.products.retrieve(price.product) : price.product;
    if (!product || product.deleted) {
      throw new Error(`Existing ${lookupKey} price does not have an active Stripe product.`);
    }
    if (product.name !== productName || product.description !== description) {
      await stripe.products.update(product.id, {
        name: productName,
        description,
      });
    }
    return price.id;
  }

  const product = await stripe.products.create({
    name: productName,
    description,
    metadata: {
      application: "ApplyPack",
      environment: "test",
      product_kind: "manual_launch_one_time",
    },
  });
  const created = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amount,
    lookup_key: lookupKey,
  });
  if (created.livemode) throw new Error("Stripe unexpectedly created a live-mode price.");
  return created.id;
}

const RETIRED_BOARD_LOOKUP_KEYS = [
  "applypack_job_board_weekly_usd_699",
  "applypack_job_board_monthly_usd_1999",
  "applypack_job_board_three_month_usd_4499",
];

async function retireBoardProducts() {
  const retiredPriceIds = [];
  const retiredProductIds = new Set();

  for (const lookupKey of RETIRED_BOARD_LOOKUP_KEYS) {
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 10 });
    for (const price of prices.data) {
      if (price.livemode || price.type !== "recurring") {
        throw new Error(`Refusing to retire unexpected ${lookupKey} price.`);
      }
      const subscriptions = await stripe.subscriptions.list({
        price: price.id,
        status: "all",
        limit: 1,
      });
      if (subscriptions.data.length > 0) {
        throw new Error(`Refusing to retire ${lookupKey}: a test subscription references it.`);
      }
      await stripe.prices.update(price.id, { active: false });
      retiredPriceIds.push(price.id);
      const productId = typeof price.product === "string" ? price.product : price.product.id;
      retiredProductIds.add(productId);
    }
  }

  for (const productId of retiredProductIds) {
    const product = await stripe.products.retrieve(productId);
    if (!product.deleted && product.active) await stripe.products.update(product.id, { active: false });
  }

  return { retiredPriceIds, retiredProductIds: [...retiredProductIds] };
}

async function main() {
  const searchPriceId = await ensurePrice({
    lookupKey: "job_match_search_usd_1899_manual_launch_v2",
    productName: "Job Match Search",
    description: "Exactly 10 distinct, current, human-reviewed job matches delivered within 24 hours",
    amount: 1_899,
  });
  const applyPackPriceId = await ensurePrice({
    lookupKey: "apply_pack_usd_799_manual_launch_v2",
    productName: "Tailored Resume + Cover Letter",
    description: "One tailored resume and one tailored cover letter for one selected job, delivered within 24 hours",
    amount: 799,
  });
  const retiredBoard = await retireBoardProducts();

  process.stdout.write(JSON.stringify({
    mode: "test",
    searchPriceId,
    applyPackPriceId,
    retiredBoard,
  }) + "\n");
}

main().catch((error) => {
  if (error?.code === "more_permissions_required") {
    process.stderr.write("Stripe test-key permissions are insufficient. Enable Products Read/Write and Prices Read/Write, then rerun.\n");
  } else {
    process.stderr.write((error instanceof Error ? error.message : "Stripe test-price setup failed.") + "\n");
  }
  process.exitCode = 1;
});
