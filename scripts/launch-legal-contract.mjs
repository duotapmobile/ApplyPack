// Current forward recovery target. The historical rollback contract remains separate.
export const HISTORICAL_086_LEGAL_BINDING = Object.freeze({
  termsVersion: "manual-launch-terms-2026-10-02-v2",
  termsContentSha256: "eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c",
  privacyVersion: "privacy-2026-10-23-v2",
  privacyContentSha256: "9fa809f25bf55a03fab529f991b1d5870849fcc2294c08b324f1d2cf0187ea16",
  acceptanceCopyVersion: "applypack-legal-acceptance-copy-2026-10-04-v1",
  acceptanceCopySha256: "0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283",
  contentCanonicalizationVersion: "applypack-c14n-v1",
  receiptSchemaVersion: "applypack-legal-content-receipt-v1",
});

export const LAUNCH_LEGAL_BINDING = Object.freeze({
  ...HISTORICAL_086_LEGAL_BINDING,
  termsVersion: "manual-launch-terms-2026-10-24-v3",
  termsContentSha256: "bac56f51e78cd099c8676efcfca5616d2fbdaeb9fc40c8aa0d5053ff968a3428",
  privacyVersion: "privacy-2026-10-24-v3",
  privacyContentSha256: "2d7a8f194c8246775f1bb9803378596bf8bf60fb2a72cb34bf3c009adaa6e311",
});
