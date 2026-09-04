import { extensionMatchesMimeType, resumeMimeTypes } from "./signatures";

export const MAX_SOURCE_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_DOCUMENTS_BY_KIND = { RESUME: 1, PRIOR_COVER_LETTER: 1 } as const;

export function validateSourceDocumentMetadata(input: {
  name: string;
  size: number;
  claimedMimeType: string;
  signatureMatches: boolean;
}) {
  if (!Number.isSafeInteger(input.size) || input.size < 1) return { allowed: false, code: "EMPTY_OR_INVALID_SIZE" } as const;
  if (input.size > MAX_SOURCE_DOCUMENT_BYTES) return { allowed: false, code: "FILE_TOO_LARGE" } as const;
  if (!resumeMimeTypes.has(input.claimedMimeType)) return { allowed: false, code: "UNSUPPORTED_MIME" } as const;
  if (!extensionMatchesMimeType(input.name, input.claimedMimeType)) return { allowed: false, code: "MIME_EXTENSION_MISMATCH" } as const;
  if (!input.signatureMatches) return { allowed: false, code: "MIME_SIGNATURE_MISMATCH" } as const;
  return { allowed: true, code: "ALLOWED" } as const;
}

export function validSourceDocumentCardinality(counts: { resume: number; priorCoverLetter: number }) {
  return Number.isInteger(counts.resume) && Number.isInteger(counts.priorCoverLetter)
    && counts.resume === 1 && counts.priorCoverLetter >= 0 && counts.priorCoverLetter <= 1;
}
