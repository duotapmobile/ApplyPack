# Document Standard Implementation Evidence — 2026-09-13

## Authority and scope

- Source supplied by the user: `C:\Users\mskir\Desktop\Apply_Pack\ResumeandCoverletterGuidelines`.
- Implementation checkout: `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`.
- This change updates the supported generation, preview, approval, release, download, DOCX inspection, and PDF-render validation paths. It does not claim deployment, Microsoft Word validation, universal ATS compatibility, PDF/UA conformance, or production delivery.

## Implemented contract

- A shared, versioned document contract now governs content, templates, and PDF export. Changing any version makes older artifacts stale at preview, approval, release, portal listing, and download boundaries.
- Generation requires the complete captured job posting hash and an exact one-to-one classification of every current job criterion as direct evidence, transferable evidence, gap, or unknown. Supported classifications require verified candidate facts; gaps and unknowns cannot carry candidate facts.
- Generated files use exact delivery names based only on the candidate, artifact type, and company. Unicode letters are preserved, role/date/version suffixes are excluded, and storage identity remains separate from the customer-visible filename.
- Resume and cover-letter formatting is bound to US Letter, one column, Arial, the approved margins and type sizes, Heading 1 section semantics, native bullets, exact spacing, and the approved section rule.
- The target role appears in the resume summary instead of a header banner. Person names, salutations, signatures, reference names, and approved historical titles retain natural presentation.
- DOCX metadata contains the document title, candidate author, target-role subject, `en-US` language, empty keywords, and no editor identity.
- LibreOffice receives the tagged-PDF writer filter as one argument and a unique temporary profile. PDF QA requires searchable text, expected page count, Arial font evidence, `Tagged: yes`, matching metadata, language metadata, and a minimum structure tree appropriate to the artifact type.
- Artifact registration records content/template/exporter versions, complete requirement mappings, posting hash, package QA, rendered-page hashes, PDF tag/metadata/structure evidence, and text hashes.

## Validation results

- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed.
- Focused Vitest contract suite: 3 files passed, 19 tests passed.
- `npm.cmd run build`: passed; production compilation, TypeScript, page-data collection, and 58 static pages completed.
- `npm.cmd run test:document-render`: blocked before rendering because the approved local renderer configuration is not available in this environment; 1 test failed at the readiness gate and 1 was skipped. No rendered DOCX/PDF or visual/assistive-technology claim is made from this run.
- Full `npm.cmd test`: not green. The run was stopped after unrelated Vitest fork teardown timeouts across multiple existing suites and two `staging-indexing` timeouts. The focused changed-area suite remained green.

## Remaining external proof

Run the dedicated render suite on a host with the approved pinned LibreOffice, Poppler, and rasterizer configuration, then perform human visual review and the required Microsoft Word and assistive-technology checks before release.
