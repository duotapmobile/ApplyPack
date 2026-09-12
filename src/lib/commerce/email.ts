import { formatEasternDeadline } from "./presentation";

export type Chunk4EmailKind =
  | "PAYMENT_VERIFIED_SEARCH_STARTED"
  | "CAPACITY_PAYMENT_EXCEPTION"
  | "ADJUSTMENT_REQUIRED"
  | "ADJUSTMENT_ACCEPTED"
  | "REFUND_INITIATED"
  | "REFUND_COMPLETED"
  | "REFUND_PROBLEM"
  | "SEARCH_EXACT_TEN_DELIVERED"
  | "SECURE_ACCESS_RESEND"
  | "PAYMENT_DISPUTE"
  | "MATERIALS_PAYMENT_VERIFIED"
  | "MATERIAL_SUBSTITUTION_ACCEPTED"
  | "MATERIAL_FACT_REVISION_ACCEPTED"
  | "MATERIALS_DELIVERED"
  | "REFERENCE_REGENERATION_STARTED"
  | "REFERENCE_REGENERATION_DELIVERED"
  | "REFERENCE_REGENERATION_FAILED";

export type Chunk4EmailInput = {
  kind: Chunk4EmailKind;
  actionUrl: string;
  orderId?: string | null;
  deadline?: string | null;
  currentValidCount?: number | null;
  criteriaDiff?: unknown;
  refundAmountCents?: number | null;
  disputeState?: string | null;
  lineCount?: number | null;
};

const titles: Record<Chunk4EmailKind, string> = {
  PAYMENT_VERIFIED_SEARCH_STARTED: "Your ApplyPack search has started",
  CAPACITY_PAYMENT_EXCEPTION: "Your ApplyPack payment is being refunded",
  ADJUSTMENT_REQUIRED: "Your ApplyPack search needs your input",
  ADJUSTMENT_ACCEPTED: "Your updated ApplyPack search has started",
  REFUND_INITIATED: "Your ApplyPack refund is processing",
  REFUND_COMPLETED: "Your ApplyPack refund is complete",
  REFUND_PROBLEM: "Your ApplyPack refund needs attention",
  SEARCH_EXACT_TEN_DELIVERED: "Your 10 ApplyPack job matches are ready",
  SECURE_ACCESS_RESEND: "Your secure ApplyPack access link",
  PAYMENT_DISPUTE: "Your ApplyPack payment status changed",
  MATERIALS_PAYMENT_VERIFIED: "Your application materials are underway",
  MATERIAL_SUBSTITUTION_ACCEPTED: "Your substitute job was accepted",
  MATERIAL_FACT_REVISION_ACCEPTED: "Your corrected material facts were accepted",
  MATERIALS_DELIVERED: "Your application materials are ready",
  REFERENCE_REGENERATION_STARTED: "Your updated reference sheet is underway",
  REFERENCE_REGENERATION_DELIVERED: "Your updated reference sheet is ready",
  REFERENCE_REGENERATION_FAILED: "Your reference-sheet update needs attention",
};

export function escapeEmailHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function absoluteHttpsUrl(value: string) {
  const url = new URL(value);
  const localDevelopmentUrl = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localDevelopmentUrl) {
    throw new Error("transactional_email_url_must_be_https");
  }
  return url.toString();
}

function money(cents = 2_000) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function diffText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "The exact before-and-after criteria are recorded in My ApplyPack.";
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 12);
  if (!entries.length) return "The exact before-and-after criteria are recorded in My ApplyPack.";
  return `Changed criteria: ${entries.map(([key]) => key.replaceAll(/([A-Z])/g, " $1").toLowerCase()).join(", ")}.`;
}

export function renderChunk4Email(input: Chunk4EmailInput) {
  const actionUrl = absoluteHttpsUrl(input.actionUrl);
  const deadline = input.deadline ? formatEasternDeadline(input.deadline) : null;
  const amount = money(input.refundAmountCents ?? 2_000);
  let lines: string[];
  let actionLabel = "Open My ApplyPack";
  switch (input.kind) {
    case "PAYMENT_VERIFIED_SEARCH_STARTED":
      actionLabel = "Access your order securely";
      lines = ["Your payment was verified and your search has started.", `Your exact delivery deadline is ${deadline || "recorded in My ApplyPack"}.`, "The secure access link below is single-use and expires in 15 minutes."];
      break;
    case "CAPACITY_PAYMENT_EXCEPTION":
      lines = ["Capacity could not be confirmed after your payment.", `Work did not start. A full ${amount} refund was initiated automatically.`, "My ApplyPack will show Refunded only after the payment provider confirms completion."];
      break;
    case "ADJUSTMENT_REQUIRED":
      lines = [`We currently have ${input.currentValidCount ?? "fewer than 10"} valid matches as work in progress.`, "Your explicit choice is required; viewing this message does not accept a change.", diffText(input.criteriaDiff), "You may accept the precise proposal or choose the full-refund option in My ApplyPack."];
      break;
    case "ADJUSTMENT_ACCEPTED":
      lines = ["Your explicit criteria change was recorded.", diffText(input.criteriaDiff), `Revised capacity was confirmed and the exact revised deadline is ${deadline || "recorded in My ApplyPack"}.`];
      break;
    case "REFUND_INITIATED":
      lines = [`A full ${amount} refund was initiated.`, "Its status is Refund processing until the payment provider confirms completion."];
      break;
    case "REFUND_COMPLETED":
      lines = [`The payment provider confirmed your full ${amount} refund.`, "The completed refund and its order history remain available in My ApplyPack."];
      break;
    case "REFUND_PROBLEM":
      lines = [`Your required full ${amount} refund was not confirmed.`, "The retry state is preserved and staff have been alerted. We will not describe the refund as complete until confirmation."];
      break;
    case "SEARCH_EXACT_TEN_DELIVERED":
      lines = ["Your immutable set of exactly 10 researched job matches is ready.", "Review each employer listing before deciding whether to apply. ApplyPack does not submit applications or guarantee interviews, offers, salary, employment, or continued listing availability."];
      break;
    case "SECURE_ACCESS_RESEND":
      actionLabel = "Access your order securely";
      lines = ["Use the secure link below to open your ApplyPack order.", "This link is single-use and expires in 15 minutes. If you did not request it, you may ignore this message."];
      break;
    case "MATERIALS_PAYMENT_VERIFIED":
      lines = [
        `Your card payment for ${input.lineCount ?? "the selected"} $8 material line${input.lineCount === 1 ? "" : "s"} was verified.`,
        `The exact active deadline is ${deadline || "recorded in My ApplyPack"}.`,
        "Each selected job receives one tailored resume and one tailored cover letter. ApplyPack does not submit applications.",
      ];
      break;
    case "MATERIAL_SUBSTITUTION_ACCEPTED":
      lines = ["Your explicit substitute-job choice was recorded.", `The replacement line deadline is ${deadline || "recorded in My ApplyPack"}.`, "No job is ever substituted silently."];
      break;
    case "MATERIAL_FACT_REVISION_ACCEPTED":
      lines = ["Your exact fact correction was recorded.", `The revised line deadline is ${deadline || "recorded in My ApplyPack"}.`, "The prior generation cannot overwrite this accepted revision."];
      break;
    case "MATERIALS_DELIVERED":
      lines = ["Your human-reviewed resume and cover letter are available in My ApplyPack.", "Files remain private and each new download requires current ownership authorization. Signed download access expires after 15 minutes."];
      break;
    case "REFERENCE_REGENERATION_STARTED":
      lines = ["Your no-charge reference-sheet update has started.", `Its exact deadline is ${deadline || "recorded in My ApplyPack"}.`, "Only references with fresh permission for this exact job may be included."];
      break;
    case "REFERENCE_REGENERATION_DELIVERED":
      lines = ["Your human-reviewed replacement reference sheet is available in My ApplyPack.", "The prior hosted sheet remains revoked; use the current file version."];
      break;
    case "REFERENCE_REGENERATION_FAILED":
      lines = ["The reference-sheet update missed its active deadline and was stopped.", "The hosted draft remains unavailable. Staff have been alerted to resolve the protected follow-up."];
      break;
    default:
      lines = [`The payment dispute state is ${input.disputeState || "being reviewed"}.`, "Undelivered work does not resume automatically. Open My ApplyPack for the recorded order and refund state."];
  }
  if (input.orderId) lines.push(`Order reference: ${input.orderId}`);
  const text = [...lines, "", `${actionLabel}: ${actionUrl}`, "", "ApplyPack support: help@applypack.work"].join("\n");
  const paragraphs = lines.map((line) => `<p style="margin:0 0 16px;line-height:1.55">${escapeEmailHtml(line)}</p>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(titles[input.kind])}</title></head><body style="margin:0;background:#f4f1ea;color:#17231b;font-family:Arial,sans-serif"><main style="max-width:600px;margin:0 auto;padding:28px 18px"><section style="background:#fff;border:1px solid #d9d5ca;border-radius:14px;padding:28px"><p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.08em">APPLYPACK</p><h1 style="font-size:26px;line-height:1.2;margin:0 0 20px">${escapeEmailHtml(titles[input.kind])}</h1>${paragraphs}<p style="margin:24px 0"><a href="${escapeEmailHtml(actionUrl)}" style="display:inline-block;background:#173f2a;color:#fff;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:8px">${escapeEmailHtml(actionLabel)}</a></p><p style="font-size:13px;color:#556159;margin:24px 0 0">Questions? Email <a href="mailto:help@applypack.work">help@applypack.work</a>.</p></section></main></body></html>`;
  return { subject: titles[input.kind], text, html };
}
