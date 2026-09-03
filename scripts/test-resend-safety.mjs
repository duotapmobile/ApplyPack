import { Resend } from "resend";

const key = process.env.RESEND_API_KEY || "";
const recipient = (process.env.TEST_EMAIL_RECIPIENT || "").trim().toLowerCase();
const allowed = new Set((process.env.APP_SAFE_TEST_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));

if (process.env.APP_PAYMENT_MODE !== "test") throw new Error("Refusing email rehearsal outside test payment mode.");
if (!key || !recipient) throw new Error("RESEND_API_KEY and TEST_EMAIL_RECIPIENT are required.");
if (!allowed.has(recipient)) throw new Error("The rehearsal recipient is not explicitly allowlisted.");

const resend = new Resend(key);
const { data, error } = await resend.emails.send({
  from: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM || "orders@applypack.work",
  to: recipient,
  replyTo: process.env.EMAIL_REPLY_TO || "help@applypack.work",
  subject: "[TEST] ApplyPack orchestration email check",
  text: "This is a test-mode delivery check. No customer order or live payment was created.",
}, { idempotencyKey: "applypack-orchestration-email-check-v1" });

if (error) throw new Error(error.message);
process.stdout.write(JSON.stringify({ sent: true, providerMessageId: data?.id || null }) + "\n");
