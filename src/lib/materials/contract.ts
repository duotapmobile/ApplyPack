export const MATERIAL_LINE_PRICE_CENTS = 800;
export const MATERIAL_MAX_LINES = 10;
export const MATERIAL_CURRENCY = "USD";
export const MATERIAL_DOWNLOAD_SECONDS = 15 * 60;
export const MATERIAL_GENERATOR_VERSION = "applypack-evidence-bound-v1";

export const careerBreakOptions = [
  { value: "KEEP_EXISTING_TIMELINE", label: "Keep my existing timeline" },
  { value: "CAREER_BREAK", label: "Use Career Break" },
  { value: "FAMILY_CAREGIVING", label: "Use Family Caregiving" },
  { value: "CUSTOM_WORDING", label: "Use my wording" },
  { value: "OMIT_ENTRY", label: "Do not add a career-break entry" },
] as const;

export type CareerBreakChoice = (typeof careerBreakOptions)[number]["value"];
export type AllowedWarningCode =
  | "UNPUBLISHED_PAY"
  | "OVERLAPPING_PAY"
  | "BENEFITS_NOT_CONFIRMED"
  | "TRAVEL_NOT_CONFIRMED";

const warningCopy: Record<AllowedWarningCode, string> = {
  UNPUBLISHED_PAY: "Compensation was not published. Verify pay before investing substantial application time.",
  OVERLAPPING_PAY: "The employer-published range overlaps your minimum; some possible offers may be below it.",
  BENEFITS_NOT_CONFIRMED: "Benefits were not confirmed in the employer listing. Verify them before applying.",
  TRAVEL_NOT_CONFIRMED: "Travel expectations were not confirmed in the employer listing. Verify them before applying.",
};

const promptInjectionPatterns = [
  /ignore\s+(all|any|the|previous|prior)\s+(instructions?|rules?|prompts?)/i,
  /system\s*(message|prompt)|developer\s*(message|prompt)/i,
  /reveal|exfiltrate|print|return|read/i,
  /(secret|credential|api[-_ ]?key|service[-_ ]?role|environment variable)/i,
  /call\s+(a\s+)?tool|execute\s+(a\s+)?command|browse\s+the\s+web/i,
  /hidden\s+text|white\s+text|zero[- ]width/i,
];

const placeholderPattern = /\[[^\]]+\]|\b(?:TBD|TODO|PLACEHOLDER|INSERT (?:NAME|DATE|COMPANY|TITLE)|YOUR NAME)\b/i;
const genericVersionToken = /(^|_)(?:final|updated|new|v2)(?=_|\.)/i;

export function materialTotalCents(selectedIds: readonly string[]) {
  const unique = new Set(selectedIds);
  if (unique.size !== selectedIds.length) throw new Error("duplicate_material_selection");
  if (selectedIds.length < 1 || selectedIds.length > MATERIAL_MAX_LINES) {
    throw new Error("material_selection_count_invalid");
  }
  return selectedIds.length * MATERIAL_LINE_PRICE_CENTS;
}

export function allowedWarning(code: AllowedWarningCode) {
  return warningCopy[code];
}

export function containsPromptInjection(value: string) {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  const signalCount = promptInjectionPatterns.reduce((count, pattern) => count + Number(pattern.test(normalized)), 0);
  return signalCount >= 2 || /<\/?(?:script|style|iframe|object|embed)\b/i.test(normalized);
}

export function cleanUntrustedDocumentText(value: string) {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
  if (containsPromptInjection(normalized)) throw new Error("untrusted_content_instruction_detected");
  return normalized.replace(/\s+/g, " ").trim();
}

export function assertDeliverableText(value: string) {
  const cleaned = cleanUntrustedDocumentText(value);
  if (!cleaned || placeholderPattern.test(cleaned)) throw new Error("deliverable_placeholder_or_empty_text");
  return cleaned;
}

export function careerBreakPresentation(input: {
  choice: CareerBreakChoice;
  customLabel?: string | null;
  start?: string | null;
  end?: string | null;
}) {
  if (input.choice === "KEEP_EXISTING_TIMELINE") return null;
  if (input.choice === "OMIT_ENTRY") return null;
  const label = input.choice === "CAREER_BREAK" ? "Career Break"
    : input.choice === "FAMILY_CAREGIVING" ? "Family Caregiving"
      : assertNeutralCareerBreakLabel(input.customLabel || "");
  const dates = [input.start, input.end].filter(Boolean).join(" – ");
  return { label, dates };
}

function assertNeutralCareerBreakLabel(value: string) {
  const cleaned = assertDeliverableText(value);
  if (cleaned.length > 80 || /\b(?:chief|ceo|president|director|manager|household engineer|domestic engineer)\b/i.test(cleaned)) {
    throw new Error("career_break_label_not_neutral");
  }
  return cleaned;
}

function unicodeTokens(value: string) {
  return value.normalize("NFKD")
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
}

export function sanitizeFilenameSegment(value: string) {
  return unicodeTokens(value).join("_").slice(0, 60);
}

export function materialFilename(input: {
  displayName: string;
  artifact: "Resume" | "Cover_Letter" | "References";
  company: string;
  position: string;
  extension: "docx" | "pdf";
  employerInstruction?: string | null;
  collisionLocation?: string | null;
  requisitionId?: string | null;
}) {
  if (input.employerInstruction) {
    const explicit = input.employerInstruction.normalize("NFKC").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
    const withExtension = explicit.toLowerCase().endsWith("." + input.extension) ? explicit : explicit + "." + input.extension;
    if (!safeFilename(withExtension)) throw new Error("unsafe_employer_filename_instruction");
    return withExtension;
  }
  const person = sanitizeFilenameSegment(input.displayName);
  const company = sanitizeFilenameSegment(input.company);
  const position = sanitizeFilenameSegment(input.position);
  if (!person || !company || !position) throw new Error("filename_source_missing");
  const suffix = [input.collisionLocation, input.requisitionId].map((value) => value ? sanitizeFilenameSegment(value) : "").filter(Boolean);
  const result = [person, input.artifact, company, position, ...suffix].join("_") + "." + input.extension;
  if (!safeFilename(result)) throw new Error("generated_filename_invalid");
  return result;
}

export function safeFilename(value: string) {
  return value.length <= 180
    && /^[^/\\]{1,175}\.(docx|pdf)$/i.test(value)
    && !/[\[\]]/.test(value)
    && !genericVersionToken.test(value);
}

export function publicMaterialState(input: {
  fulfillment: string;
  substitution: string;
  refundState?: string | null;
  dueAt?: string | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  if (input.refundState === "SUCCEEDED") return { label: "Refunded", message: "The full $8 line refund was confirmed." };
  if (input.refundState === "PENDING") return { label: "Refund processing", message: "The required $8 line refund is still processing." };
  if (input.refundState === "FAILED") return { label: "Refund problem", message: "The required refund needs staff attention." };
  if (input.substitution === "REQUIRED" || input.substitution === "OFFERED") {
    return { label: "Choose a substitute or refund", message: "This listing or its submission instructions changed. ApplyPack will never substitute silently." };
  }
  if (input.fulfillment === "DELIVERED") return { label: "Delivered", message: "Your current approved files are available below." };
  if (input.dueAt && now.getTime() > new Date(input.dueAt).getTime()) {
    return { label: "Delayed — refund required", message: "The active 24-hour deadline passed; this line must be refunded." };
  }
  if (input.fulfillment === "HUMAN_REVIEW" || input.fulfillment === "READY_TO_RELEASE") {
    return { label: "Human review", message: "Content and rendered pages are being reviewed separately before release." };
  }
  if (input.fulfillment === "GENERATING") return { label: "Preparing your files", message: "Evidence-bound document generation is in progress." };
  if (input.fulfillment === "PAID") return { label: "Payment confirmed", message: "Payment and capacity are verified; preparation is ready to start." };
  return { label: "Pending", message: "No payment-backed materials work has started." };
}

export function referenceReadiness(input: {
  timing: "OPTIONAL_NOW" | "REQUIRED_NOW" | "PROHIBITED_NOW" | "LATER_OR_UNKNOWN";
  selectedCount: number;
  employerCount?: number | null;
}) {
  if (input.timing === "PROHIBITED_NOW") return { state: "DISABLED", action: "The employer prohibits references at this stage." };
  const maximum = Math.min(3, input.employerCount || 3);
  if (input.timing === "REQUIRED_NOW" && input.selectedCount < Math.min(1, maximum)) {
    return { state: "NEEDS_CUSTOMER_ACTION", action: "Complete and permission references before checkout." };
  }
  if (input.employerCount && input.employerCount > 3) {
    return { state: "NEEDS_CUSTOMER_ACTION", action: `ApplyPack can include three; provide the remaining ${input.employerCount - 3} yourself.` };
  }
  return { state: "READY", action: input.selectedCount ? "Exact-job permissions are ready." : "No reference sheet selected." };
}
