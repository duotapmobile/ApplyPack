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

async function main() {
const searchPriceId = await ensurePrice({
  lookupKey: "job_match_search_usd_2000",
  productName: "Job Match Search",
  description: "10 matched jobs delivered within 24 hours",
  amount: 2_000,
});
const applyPackPriceId = await ensurePrice({
  lookupKey: "apply_pack_usd_800",
  productName: "Apply Pack",
  description: "One tailored resume and cover letter for one selected job",
  amount: 800,
});

process.stdout.write(JSON.stringify({ mode: "test", searchPriceId, applyPackPriceId }) + "\n");
}

main().catch((error) => {
  if (error?.code === "more_permissions_required") {
    process.stderr.write("Stripe test-key permissions are insufficient. Enable Products Read/Write and Prices Read/Write, then rerun.\n");
  } else {
    process.stderr.write((error instanceof Error ? error.message : "Stripe test-price setup failed.") + "\n");
  }
  process.exitCode = 1;
});
