import { isLiveopsReference } from "@/lib/jobs/canonicalize";

export const VERIFICATION_POLICY_VERSION = "listing-verification-v1";
export type FraudSignal = "UNVERIFIABLE_EMPLOYER" | "LOOKALIKE_DOMAIN" | "ABSENT_FROM_EXPECTED_OFFICIAL_SITE" | "EQUIPMENT_CHECK_OR_TRANSFER" | "SUSPICIOUS_EARLY_PII" | "TEXT_ONLY_INTERVIEW" | "INCONSISTENT_CONTACT_DOMAIN" | "IMPLAUSIBLE_COMPENSATION";

export function assessLegitimacy(signals: readonly FraudSignal[]) {
  const unique = [...new Set(signals)];
  const material = unique.includes("EQUIPMENT_CHECK_OR_TRANSFER")
    || unique.includes("SUSPICIOUS_EARLY_PII")
    || (unique.includes("LOOKALIKE_DOMAIN") && unique.includes("INCONSISTENT_CONTACT_DOMAIN"))
    || (unique.includes("IMPLAUSIBLE_COMPENSATION") && unique.some((s) => s !== "IMPLAUSIBLE_COMPENSATION"));
  return { signals: unique.sort(), disposition: material ? "FAIL" as const : unique.length >= 2 ? "NEEDS_HUMAN_REVIEW" as const : "PASS" as const };
}

export function releaseVerification(input: { sourceId: string; company: string; urls: readonly string[]; listingActive: boolean | null; applicationActionable: boolean | null; lastLiveVerifiedAt: string | null; now: string; ttlSeconds?: number }) {
  if (isLiveopsReference(input.sourceId, input.company, ...input.urls)) return { eligible: false, reason: "BLOCKED_SOURCE" as const };
  if (!Number.isFinite(input.ttlSeconds) || !Number.isInteger(input.ttlSeconds) || input.ttlSeconds! <= 0) return { eligible: false, reason: "UNSET_BLOCKING" as const };
  if (!input.listingActive || !input.applicationActionable || !input.lastLiveVerifiedAt) return { eligible: false, reason: "VERIFICATION_INCOMPLETE" as const };
  const age = Date.parse(input.now) - Date.parse(input.lastLiveVerifiedAt);
  if (!Number.isFinite(age) || age < 0 || age > input.ttlSeconds! * 1000) return { eligible: false, reason: "VERIFICATION_EXPIRED" as const };
  return { eligible: true, reason: null };
}

export function safePostedDate(postedAt: string | null | undefined, firstSeenAt: string) {
  if (!postedAt) return { postedOn: null, postedDateUnknown: true, rankFreshnessAt: firstSeenAt };
  const time = Date.parse(postedAt);
  if (!Number.isFinite(time)) throw new Error("invalid_posted_date");
  return { postedOn: new Date(time).toISOString().slice(0, 10), postedDateUnknown: false, rankFreshnessAt: new Date(time).toISOString() };
}
