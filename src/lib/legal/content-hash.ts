import { publicPages, type PublicPage } from "@/content/public-pages";
import { canonicalSha256, CANONICALIZATION_VERSION } from "@/lib/domain/foundation";
import { LEGAL_ACCEPTANCE_COPY_VERSION, LEGAL_ACCEPTANCE_PRESENTATION } from "@/lib/legal/presentation";

export const CURRENT_TERMS_VERSION = "manual-launch-terms-2026-10-02-v2";
export const CURRENT_PRIVACY_VERSION = "privacy-v1";
export const LEGAL_RECEIPT_SCHEMA_VERSION = "applypack-legal-content-receipt-v1";

function visibleLegalContent(page: PublicPage) {
  return {
    slug: page.slug,
    eyebrow: page.eyebrow,
    title: page.title,
    intro: page.intro,
    sections: page.sections,
    ctaLabel: page.ctaLabel,
    ctaHref: page.ctaHref,
  };
}

export function currentLegalContentBinding() {
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    termsContentSha256: canonicalSha256(visibleLegalContent(publicPages.terms)),
    privacyContentSha256: canonicalSha256(visibleLegalContent(publicPages.privacy)),
    acceptanceCopyVersion: LEGAL_ACCEPTANCE_COPY_VERSION,
    acceptanceCopySha256: canonicalSha256(LEGAL_ACCEPTANCE_PRESENTATION),
    contentCanonicalizationVersion: CANONICALIZATION_VERSION,
    receiptSchemaVersion: LEGAL_RECEIPT_SCHEMA_VERSION,
  } as const;
}
