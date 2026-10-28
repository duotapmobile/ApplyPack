# Open-Font Document Contract Evidence

Date: 2026-10-19
Status: source implemented; hosted approval pending

## Bound source contract

- Current authority: `docs/applypack/15_UNIVERSAL_RESUME_AND_COVER_LETTER_STANDARD.txt`
- Standard SHA-256: `2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778`
- Font: Liberation Sans 2.1.5, SIL OFL 1.1
- Four-face manifest: `docs/evidence/OPEN_FONT_MANIFEST_2026-10-19.json`
- Migration: `202610190081_open_font_document_contract.sql`
- Current generator version: `applypack-universal-document-standard-2026-10-19.1`

The generator retains US Letter, one-column layout, 0.55-inch vertical and
0.70-inch side margins, exact type sizes, native Word lists, semantic headings,
metadata, claim provenance, one/two-page controls, tagged/searchable PDF QA,
visual review, and direct-application binding. The only formatting-authority
substitution is Liberation Sans for the prior proprietary Arial dependency.

## Delivery format

PDF remains the default. The operator can record one immutable, auditable DOCX
request per material line. Current generation binds that request, its reference
hash, the current employer-rule snapshot, and the resulting reason into artifact
provenance. Employer disallowance blocks a conflicting applicant request.

## Fail-closed state

Migration 081 revokes all earlier material-generation approval and clears the
renderer/font approval fields. New generation, Apply Pack checkout, production
health, canary release, and public checkout must stay false until a deployed
worker proves the exact four faces and composite manifest, a human approves new
rendered evidence, and the approval is stored. Source conformance is not hosted
or production approval.
