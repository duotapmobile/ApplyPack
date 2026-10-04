import { createHash } from "node:crypto";

export const APPROVED_ROLLBACK_LEGAL_CONTRACT = Object.freeze({
  publicPagesSourceSha256: "6704e2888f06df440bc5e7663994d0cd162d7661c02bf2d55d77bce423149384",
  termsVersion: "manual-launch-terms-2026-10-02-v2",
  termsContentSha256: "eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c",
  privacyVersion: "privacy-v1",
  privacyContentSha256: "9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9",
  acceptanceCopyVersion: "applypack-legal-acceptance-copy-2026-10-04-v1",
  acceptanceCopySha256: "0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283",
  contentCanonicalizationVersion: "applypack-c14n-v1",
  receiptSchemaVersion: "applypack-legal-content-receipt-v1",
});

const legacyLegalCopy = '<span>I agree to the <Link href="/terms" target="_blank">Terms</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>.</span>';
const presentationSignals = [
  'prefix: "I agree to the "',
  'termsLabel: "Terms"',
  'termsHref: "/terms"',
  'conjunction: " and "',
  'privacyLabel: "Privacy Policy"',
  'privacyHref: "/privacy"',
  'suffix: "."',
];

function sha256(value) {
  return createHash("sha256").update(value.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export function verifyRollbackLegalSource({ publicPagesSource, wizardSource, presentationSource = "" }) {
  const failures = [];
  if (sha256(publicPagesSource) !== APPROVED_ROLLBACK_LEGAL_CONTRACT.publicPagesSourceSha256) {
    failures.push("legal_pages_source_mismatch");
  }
  const copyCompatible = wizardSource.includes(legacyLegalCopy)
    || (wizardSource.includes("LEGAL_ACCEPTANCE_PRESENTATION")
      && presentationSignals.every((signal) => presentationSource.includes(signal)));
  if (!copyCompatible) failures.push("legal_acceptance_copy_mismatch");
  return { ok: failures.length === 0, failures };
}
