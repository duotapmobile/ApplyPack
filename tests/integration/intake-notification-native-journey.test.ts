import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createResearchLocalDatabase } from "./research-local-database";
vi.mock("server-only", () => ({}));
const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: transport.send }; } }));
import { processChunk4Outbox } from "@/lib/commerce/outbox";
import { intakeNotificationEnvelopeSha256, type IntakeNotificationEnvelope } from "@/lib/commerce/intake-notification";

afterEach(() => { vi.unstubAllEnvs(); transport.send.mockReset(); });
const id = (n: number) => `a1120000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const paymentCustomer = "a1100001-0000-4000-8000-000000000001";
const paymentMessage = "a1100026-0000-4000-8000-000000000001";

it("uses generated notification SDK calls and real SQL pins before simulated provider delivery and retries", async () => {
  const database = await createResearchLocalDatabase();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack.work");
  vi.stubEnv("RESEND_API_KEY", "fictional-local-transport-only");
  vi.stubEnv("EMAIL_FROM_ADDRESS", "orders@applypack.work");
  vi.stubEnv("EMAIL_REPLY_TO", "help@applypack.work");
  vi.stubEnv("APP_PAYMENT_MODE", "test");
  vi.stubEnv("APP_SAFE_TEST_EMAILS", "notification-intake@example.invalid,verified-changed@example.invalid,changed-again@example.invalid,chunk4-customer@example.invalid");

  // Reuse the published engine fixture's actual verified create/save/finalize
  // operations. A separate namespace preserves the preceding route evidence.
  const ownership = await readFile("tests/integration/verified-intake-ownership.sql", "utf8");
  const questionCut = ownership.indexOf("create temp table owned_question as");
  expect(questionCut).toBeGreaterThan(0);
  const questionSeed = ownership.slice(0, questionCut).replaceAll("a1080000", "a1120000").replaceAll("owned-", "notification-")
    .replaceAll("repeat('a8',32)", "repeat('a2',32)").replaceAll("repeat('b8',32)", "repeat('b2',32)").replaceAll("repeat('c8',32)", "repeat('c2',32)");
  const questionCall = `select public.ap_issue_candidate_question('${id(20)}','${id(30)}','${id(31)}','${id(2)}','Please describe the scheduling tools you personally used.');`;
  await database.script(`${questionSeed}\n${questionCall}\n${questionCall}\nupdate public.ap_commerce_configuration set provider_idempotent_email_approved=true,provider_email_approval_reference='fictional notification transport fixture' where singleton; commit;`);
  const notices = await database.sql(`select jsonb_agg(jsonb_build_object('id',m.id,'key',m.provider_idempotency_key)) from public.ap_intake_clarification_notices n join public.ap_outbox_messages m on m.id=n.message_id where n.root_draft_id='${id(10)}'`, true);
  expect(notices).toHaveLength(1);

  const accepted = new Map<string, { body: IntakeNotificationEnvelope; id: string }>();
  const lostResponses = new Set<string>();
  const attempts: { body: IntakeNotificationEnvelope; key: string }[] = [];
  transport.send.mockImplementation(async (body: IntakeNotificationEnvelope, options: { idempotencyKey: string }) => {
    const key = options.idempotencyKey, prior = accepted.get(key);
    attempts.push({ body: structuredClone(body), key });
    if (prior && JSON.stringify(prior.body) !== JSON.stringify(body)) throw new Error("fictional_provider_idempotency_conflict");
    const receipt = prior ?? { body: structuredClone(body), id: `fictional-provider-${accepted.size + 1}` };
    accepted.set(key, receipt);
    if (lostResponses.delete(key)) throw new Error("fictional_accepted_response_lost");
    return { data: { id: receipt.id }, error: null };
  });
  const state = (messageId: string) => database.sql(`select to_jsonb(m) from public.ap_outbox_messages m where id='${messageId}'`, true);
  const retry = (messageId: string) => database.script(`update public.ap_outbox_messages set next_attempt_at=clock_timestamp()-interval '1 second' where id='${messageId}' and state='RETRY';`);
  const work = () => processChunk4Outbox(database.admin, "notification-native-worker", 25);

  // The simulated provider accepts before its response is lost. SQL must keep
  // RETRY, and an environment change must not change this key's pinned body.
  const notice = notices[0]; lostResponses.add(notice.key);
  await work();
  expect((await state(notice.id)).state, JSON.stringify(database.failures)).toBe("RETRY");
  const noticeBody = accepted.get(notice.key)!.body;
  const noticePin = await database.sql(`select to_jsonb(n) from public.ap_intake_clarification_notices n where message_id='${notice.id}'`, true);
  expect(noticePin.delivery_envelope_sha256).toBe(intakeNotificationEnvelopeSha256(noticeBody));
  expect(noticeBody.to).toBe("notification-intake@example.invalid");
  expect(noticeBody.text).toContain("https://applypack.work/my-applypack");
  for (const privateValue of ["scheduling tools", id(10), id(20), "invitationSecret", "access="]) expect(JSON.stringify(noticeBody)).not.toContain(privateValue);
  const beforeChangedOrigin = attempts.length;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.applypack.work"); await retry(notice.id); await work();
  expect(attempts).toHaveLength(beforeChangedOrigin); expect((await state(notice.id)).state).toBe("RETRY");
  expect(database.failures.some(failure => failure.includes("ap_pin_intake_clarification_delivery") && failure.includes("intake_notice_envelope_changed"))).toBe(true);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack.work"); await retry(notice.id); await work();
  expect((await state(notice.id)).state).toBe("SENT");
  expect(attempts.filter(a => a.key === notice.key).map(a => a.body)).toEqual([noticeBody, noticeBody]);

  // Actual authorized checkout and verified settlement, with no Stripe call.
  // This is the published historical-v3 claim/payment fixture; the v4 notice
  // above separately uses real verified creation and full-review finalization.
  const payment = await readFile("tests/integration/verified-intake-payment.sql", "utf8");
  const paymentCut = payment.indexOf("savepoint historical_unclaimed_payment;");
  expect(paymentCut).toBeGreaterThan(0);
  const reviewedSource = await readFile("tests/integration/reviewed-source-fixture.sql", "utf8");
  const paymentSeed = payment.slice(0, paymentCut).replace("\\ir reviewed-source-fixture.sql", () => reviewedSource);
  expect(paymentSeed).toContain(reviewedSource);
  expect(paymentSeed).not.toContain("\\ir");
  await database.script(`${paymentSeed}\nselect pg_temp.owned_payment_checkout(true);
    update auth.users set email='verified-changed@example.invalid' where id='${paymentCustomer}';
    update public.profiles set email='verified-changed@example.invalid' where id='${paymentCustomer}';
    update auth.users set email='chunk4-customer@example.invalid' where id='a1100001-0000-4000-8000-000000000002';
    update public.profiles set email='chunk4-customer@example.invalid' where id='a1100001-0000-4000-8000-000000000002';
    select pg_temp.apply_owned_payment('${paymentCustomer}'); commit;`);
  const paid = await state(paymentMessage); lostResponses.add(paid.provider_idempotency_key);
  await work();
  const paidRetry = await state(paymentMessage), paidBody = accepted.get(paid.provider_idempotency_key)!.body;
  expect(paidRetry.state, JSON.stringify(database.failures)).toBe("RETRY");
  expect(paidRetry.claimed_recipient_email).toBe("verified-changed@example.invalid");
  expect(paidRetry.claimed_delivery_envelope_sha256).toBe(intakeNotificationEnvelopeSha256(paidBody));
  expect(paidBody.to).toBe("verified-changed@example.invalid");
  expect(paidBody.text).toContain("/my-applypack?order=");
  expect(JSON.stringify(paidBody)).not.toMatch(/auth\/order-access|access=|emailAccessSecret/u);
  expect(await database.sql(`select to_jsonb(count(*)) from public.ap_order_access_capabilities where order_id='a1100021-0000-4000-8000-000000000001' and kind='EMAIL_ACCESS'`, true)).toBe(0);
  const beforeChangedRecipient = attempts.length;
  await database.script(`update auth.users set email='changed-again@example.invalid' where id='${paymentCustomer}';`);
  await retry(paymentMessage); await work();
  expect(attempts).toHaveLength(beforeChangedRecipient); expect((await state(paymentMessage)).state).toBe("RETRY");
  expect(database.failures.some(failure => failure.includes("ap_prepare_claimed_payment_notification") && failure.includes("claimed_payment_recipient_changed"))).toBe(true);
  await database.script(`update auth.users set email='verified-changed@example.invalid' where id='${paymentCustomer}';`);
  await retry(paymentMessage); await work();
  expect((await state(paymentMessage)).state).toBe("SENT");
  expect(attempts.filter(a => a.key === paid.provider_idempotency_key).map(a => a.body)).toEqual([paidBody, paidBody]);

  // Existing direct-customer history has no anonymous draft and keeps the
  // explicit unclaimed path, including its original transactional recipient.
  const historicalStart = payment.indexOf("-- Older customer-owned snapshots");
  const historicalEnd = payment.indexOf("select count(*) from public.ap_claim_outbox_messages('historical-no-draft-fixture'", historicalStart);
  expect(historicalStart).toBeGreaterThan(0); expect(historicalEnd).toBeGreaterThan(historicalStart);
  await database.script(payment.slice(historicalStart, historicalEnd));
  await work();
  const historical = await state("a1100043-0000-4000-8000-000000000001");
  expect(historical.state, JSON.stringify(database.failures)).toBe("SENT");
  expect(historical.claimed_root_draft_id).toBeNull();
  expect(accepted.get(historical.provider_idempotency_key)!.body.to).toBe("chunk4-customer@example.invalid");
  expect(accepted.size).toBe(3);
  console.info("NOTIFICATION_SDK_SQL_JOURNEY_OK: actual ownership/payment/outbox/pins; three fictional provider acceptances; no real messages.");
});
