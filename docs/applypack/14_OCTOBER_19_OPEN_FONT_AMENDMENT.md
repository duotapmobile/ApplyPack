# October 19 Open-Font Document Amendment

Date: 2026-10-19
Status: governing forward amendment

## Authority and scope

The user-designated formatting authority is `Formatting (1).txt`, normalized
SHA-256 `e0a94de45abb7ecbd0f770fb0e8295eeb3aef33d7fe4e75b02f7d4dd77791299`.
It supersedes the later, longer `Formatting(2).txt` for document layout and
structure. The tracked standard in
`15_UNIVERSAL_RESUME_AND_COVER_LETTER_STANDARD.txt` preserves its 682-line
structure and all 32 sections exactly, except that the illustrative phrase
"such as Arial" is replaced with the approved free font contract. Its
normalized SHA-256 is
`2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778`.

This amendment changes only the font dependency and the explicit provenance
needed to honor an applicant's Word-format request. The October 2 manual-launch
amendment, the October 3 locked-format standard, and earlier document standards
remain immutable historical authority for already-created artifacts.

## Current font contract

Every new generated artifact uses Liberation Sans 2.1.5 under SIL Open Font
License 1.1. Regular, bold, italic, and bold-italic faces are byte-pinned. Their
canonical composite manifest SHA-256 is
`d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb`.
Substitution or fallback is a hard failure. The worker image, local renderer,
runtime readiness, material-generation approval, generated-artifact provenance,
and hosted synthetic probe must all agree with the four-face manifest.

No Arial purchase, upload, BuildKit secret, or proprietary font file is part of
the current build or release process.

## Delivery-format authority

PDF remains the normal customer-facing format. A genuine DOCX is delivered
only when one of the current standard's exceptions applies: an immutable
applicant Word request, an employer DOCX requirement, a verified portal PDF
rejection, or an approved editable fallback. An applicant preference never
overrides an employer prohibition. Every current artifact records the exact
delivery-format reason, employer-rule snapshot, and, when applicable, the
immutable applicant-request receipt and its non-sensitive reference hash.

## Launch effect

Migration `202610190081_open_font_document_contract.sql` revokes the prior
material-generation approval and clears prior renderer/font approvals. The
checkout, generation, canary, and public-launch gates remain locked until the
new four-face renderer is deployed, probed, human-reviewed, and explicitly
approved. Historical downloads remain accessible under their immutable
generator versions but cannot authorize new generation or release.
