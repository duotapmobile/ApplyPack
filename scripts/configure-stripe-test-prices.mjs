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
    metadata: { application: "ApplyPack", environment: "test" },
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

async function ensureRecurringPrice({ lookupKey, productName, description, amount, interval, intervalCount }) {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 10,
    expand: ["data.product"],
  });
  const price = existing.data[0];
  if (price) {
    if (price.livemode || price.currency !== "usd" || price.unit_amount !== amount
      || price.type !== "recurring" || price.recurring?.interval !== interval
      || price.recurring.interval_count !== intervalCount || price.recurring.usage_type !== "licensed") {
      throw new Error(`Existing ${lookupKey} price does not match the required test-mode recurring plan.`);
    }
    const product = typeof price.product === "string" ? await stripe.products.retrieve(price.product) : price.product;
    if (!product || product.deleted) throw new Error(`Existing ${lookupKey} price does not have an active Stripe product.`);
    if (product.name !== productName || product.description !== description) {
      await stripe.products.update(product.id, { name: productName, description });
    }
    return price.id;
  }

  const product = await stripe.products.create({
    name: productName,
    description,
    metadata: { application: "ApplyPack", environment: "test", product_kind: "job_board_subscription" },
  });
  const created = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amount,
    lookup_key: lookupKey,
    recurring: { interval, interval_count: intervalCount, usage_type: "licensed" },
  });
  if (created.livemode) throw new Error("Stripe unexpectedly created a live-mode recurring price.");
  return created.id;
}

async function main() {
const searchPriceId = await ensurePrice({
  lookupKey: "job_match_search_usd_2000",
  productName: "Job Match Search",
  description: "10 matched jobs delivered within 24 hours",
  amount: 2_000,
});
const applyPackPriceId = await ensurePrice({
  lookupKey: "apply_pack_usd_800",
  productName: "Tailored Resume + Cover Letter",
  description: "One tailored resume and cover letter for one selected job",
  amount: 800,
});
const boardWeeklyPriceId = await ensureRecurringPrice({
  lookupKey: "applypack_job_board_weekly_usd_699",
  productName: "ApplyPack Job Board - Weekly",
  description: "Filtered, neutrally sorted job board billed weekly with no free trial",
  amount: 699,
  interval: "week",
  intervalCount: 1,
});
const boardMonthlyPriceId = await ensureRecurringPrice({
  lookupKey: "applypack_job_board_monthly_usd_1999",
  productName: "ApplyPack Job Board - Monthly",
  description: "Filtered, neutrally sorted job board billed monthly with no free trial",
  amount: 1_999,
  interval: "month",
  intervalCount: 1,
});
const boardThreeMonthPriceId = await ensureRecurringPrice({
  lookupKey: "applypack_job_board_three_month_usd_4499",
  productName: "ApplyPack Job Board - Three Months",
  description: "Filtered, neutrally sorted job board billed every three calendar months with no free trial",
  amount: 4_499,
  interval: "month",
  intervalCount: 3,
});

process.stdout.write(JSON.stringify({
  mode: "test",
  searchPriceId,
  applyPackPriceId,
  boardWeeklyPriceId,
  boardMonthlyPriceId,
  boardThreeMonthPriceId,
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
