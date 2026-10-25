import { DOCUMENT_STANDARD_SHA256, DOCUMENT_VERSIONS } from "./requirements";

// Preparation identity only. The historical production allowlist intentionally
// rejects this format until a separately approved forward acceptance contract.
export const DRAFT_DOCX_VERSIONS = Object.freeze({ ...DOCUMENT_VERSIONS,
  content: "applypack-content-2026-10-25.1", template: "applypack-template-2026-10-25.1" });
export const DRAFT_DOCX_GENERATOR_VERSION = ["applypack-documents", `instructions=${DRAFT_DOCX_VERSIONS.instructions}`,
  `standardSha256=${DOCUMENT_STANDARD_SHA256}`, `content=${DRAFT_DOCX_VERSIONS.content}`,
  `template=${DRAFT_DOCX_VERSIONS.template}`, `exporter=${DRAFT_DOCX_VERSIONS.exporter}`].join("|");
