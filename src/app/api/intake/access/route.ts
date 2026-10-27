import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createDraftCapability, draftCookieSettings, hashDraftSecret, parseDraftCapability, serializeDraftCapability } from "@/lib/security/draft-capability";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { newIntakeRecoveryHold } from "@/lib/operations/protected-recovery-readiness";
import { boundedIntakeJson } from "@/lib/intake/confirmed-review-server";
import { verifiedIntakeActionSchema } from "@/lib/intake/verified-intake-contract";
import { ownedIntakeList, ownedIntakeMetadata, readOwnedIntakeContext, verifiedIntakeIdentity } from "@/lib/intake/verified-intake-server";

const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
const unavailable = () => NextResponse.json({ error: "Your saved intakes could not be checked. Please try again." }, { status: 503, headers });
const changed = () => NextResponse.json({ error: "This intake could not be opened. Check your account and saved intakes before trying again." }, { status: 409, headers });

async function context() {
  const identity = await verifiedIntakeIdentity();
  if (!identity) return { response: NextResponse.json({ error: "Verify your account email to open your intake." }, { status: 401, headers }) };
  const admin = createSupabaseAdminClient(), settings = draftCookieSettings();
  if (!admin || !settings) return { response: unavailable() };
  const capability = parseDraftCapability((await cookies()).get(settings.name)?.value);
  return { identity, admin, settings, capability };
}

export async function GET() {
  try {
    const ctx = await context(); if (ctx.response) return ctx.response;
    const { admin, identity, capability } = ctx;
    const current = capability ? await readOwnedIntakeContext(admin, identity, capability) : null;
    const listed = await admin.rpc("ap_owned_intake_drafts", { p_customer_id: identity.customerId, p_limit: 20 }).abortSignal(AbortSignal.timeout(10_000));
    if (listed.error) return unavailable();
    return NextResponse.json({ verifiedEmail: identity.verifiedEmail, browserDraftId: capability?.draftId ?? null,
      current, drafts: ownedIntakeList(listed.data, identity), claimAvailable: Boolean(capability && !current) }, { headers });
  } catch { return unavailable(); }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This intake request was rejected." }, { status: 403, headers });
  const parsed = verifiedIntakeActionSchema.safeParse(await boundedIntakeJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Choose the saved intake or start action again." }, { status: 400, headers });
  try {
    const ctx = await context(); if (ctx.response) return ctx.response;
    const { admin, identity, settings, capability } = ctx, input = parsed.data;
    if ((capability?.draftId ?? null) !== input.expectedBrowserDraftId) return changed();
    const current = capability ? await readOwnedIntakeContext(admin, identity, capability) : null;
    if (input.action !== "CLAIM" && capability && !current && !input.replaceUnlinkedBrowserIntake) return changed();
    const hold = await newIntakeRecoveryHold(admin); if (hold) return hold;
    const rate = await consumeRateLimit({ request, scope: "verified_intake_access", identity: identity.customerId, limit: 20, windowSeconds: 15 * 60 });
    if (!rate.configured) return unavailable();
    if (!rate.allowed) return NextResponse.json({ error: "Too many intake access attempts. Please wait before trying again." }, { status: 429, headers });
    const next = input.action === "CLAIM" ? capability : createDraftCapability();
    if (!next) return changed();
    if (input.action === "RESUME") next.draftId = input.expectedDraftId;
    const result = input.action === "START"
      ? await admin.rpc("ap_create_owned_intake_draft", { p_customer_id: identity.customerId, p_verified_email: identity.verifiedEmail,
        p_request_id: input.requestId, p_draft_id: next.draftId, p_secret_hash: hashDraftSecret(next.secret),
        p_expires_at: new Date(Date.now() + Math.min(settings.maxAge, 7 * 24 * 60 * 60) * 1_000).toISOString() }).abortSignal(AbortSignal.timeout(10_000))
      : input.action === "CLAIM"
        ? await admin.rpc("ap_claim_intake_draft", { p_customer_id: identity.customerId, p_verified_email: identity.verifiedEmail,
          p_draft_id: next.draftId, p_secret_hash: hashDraftSecret(next.secret) }).abortSignal(AbortSignal.timeout(10_000))
        : await admin.rpc("ap_resume_owned_intake_draft", { p_customer_id: identity.customerId, p_root_draft_id: input.rootDraftId,
          p_expected_draft_id: input.expectedDraftId, p_expected_capability_version: input.expectedCapabilityVersion,
          p_secret_hash: hashDraftSecret(next.secret) }).abortSignal(AbortSignal.timeout(10_000));
    if (result.error) return changed();
    const { summary } = ownedIntakeMetadata(result.data, identity);
    if (input.action === "RESUME" && (summary.rootDraftId !== input.rootDraftId || summary.draftId !== input.expectedDraftId
      || summary.capabilityVersion < input.expectedCapabilityVersion || summary.capabilityVersion > input.expectedCapabilityVersion + 1)) return unavailable();
    // An idempotent create or source-cookie claim may identify a saved leaf
    // whose secret this response does not possess. Selection must be explicit.
    if (summary.draftId !== next.draftId) return NextResponse.json({ state: "RESUME_REQUIRED", rootDraftId: summary.rootDraftId }, { headers });
    const verified = await readOwnedIntakeContext(admin, identity, next);
    if (!verified) return NextResponse.json({ state: "RESUME_REQUIRED", rootDraftId: summary.rootDraftId }, { headers });
    if (verified.rootDraftId !== summary.rootDraftId || verified.capabilityVersion !== summary.capabilityVersion || verified.version !== summary.version
      || Date.parse(verified.expiresAt) !== Date.parse(summary.expiresAt)) return unavailable();
    const remaining = Math.floor((Date.parse(summary.expiresAt) - Date.now()) / 1_000);
    if (remaining < 1) return unavailable();
    const response = NextResponse.json({ state: "OPENED", draftId: summary.draftId }, { headers });
    if (input.action !== "CLAIM") response.cookies.set(settings.name, serializeDraftCapability(next), {
      ...settings, maxAge: Math.min(settings.maxAge, remaining), expires: new Date(summary.expiresAt),
    });
    return response;
  } catch { return unavailable(); }
}
