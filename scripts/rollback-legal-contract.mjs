import { createHash } from "node:crypto";

export const APPROVED_ROLLBACK_LEGAL_CONTRACT = Object.freeze({
  publicPagesSourceSha256: "6704e2888f06df440bc5e7663994d0cd162d7661c02bf2d55d77bce423149384",
  presentationSourceSha256: "f5f162603fead520d4777f142bc6a3f1449da49a3fb2c05aa45dffde97ff4d06",
  wizardSourceSha256: "a358b1142b7a0cd9db1a69dde5e82a61687a3fceb06fe3efac94f18c883d8f83",
  legacyWizardSourceSha256: "587c9c56dd101779d521aa513185944af05d6aed9e539ab4be3a7267fdb734d5",
  termsVersion: "manual-launch-terms-2026-10-02-v2",
  termsContentSha256: "eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c",
  privacyVersion: "privacy-v1",
  privacyContentSha256: "9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9",
  acceptanceCopyVersion: "applypack-legal-acceptance-copy-2026-10-04-v1",
  acceptanceCopySha256: "0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283",
  contentCanonicalizationVersion: "applypack-c14n-v1",
  receiptSchemaVersion: "applypack-legal-content-receipt-v1",
});

function sha256(value) {
  return createHash("sha256").update(value.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export function verifyRollbackLegalSource({ publicPagesSource, wizardSource, presentationSource = "" }) {
  const failures = [];
  if (sha256(publicPagesSource) !== APPROVED_ROLLBACK_LEGAL_CONTRACT.publicPagesSourceSha256) {
    failures.push("legal_pages_source_mismatch");
  }
  const copyCompatible = presentationSource
    ? sha256(presentationSource) === APPROVED_ROLLBACK_LEGAL_CONTRACT.presentationSourceSha256
      && sha256(wizardSource) === APPROVED_ROLLBACK_LEGAL_CONTRACT.wizardSourceSha256
    : sha256(wizardSource) === APPROVED_ROLLBACK_LEGAL_CONTRACT.legacyWizardSourceSha256;
  if (!copyCompatible) failures.push("legal_acceptance_copy_mismatch");
  return { ok: failures.length === 0, failures };
}
