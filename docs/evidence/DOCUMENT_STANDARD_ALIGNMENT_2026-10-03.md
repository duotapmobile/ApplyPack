# October 3 Document Standard Alignment

Date: 2026-10-03

Status: source implementation accepted locally; public checkout remains locked.

## Authority binding

The supplied `Formatting(2).txt` is preserved line-for-line at
`docs/applypack/13_UNIVERSAL_RESUME_AND_COVER_LETTER_STANDARD.txt`.

Normalized LF SHA-256:

`1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf`

The generator version includes both the immutable instruction version and this
hash. A unit test recomputes the tracked file hash so a silent standard change
fails acceptance.

## Enforced in code

- Candidate identity, contact details, employment, education, references, job
  requirements, company, role, direct application URL, and observation dates
  are read from verified inputs. No applicant profile is hard-coded.
- Generated factual claims retain immutable candidate-fact and job-evidence
  identifiers. Artifacts also bind the job URL, retrieval date, posting hash,
  generator tuple, and a deterministic cache identity.
- Résumés and cover letters use US Letter pages, 0.55-inch top/bottom margins,
  0.70-inch side margins, Arial, black text, one column, real paragraph styles,
  native bullets, and dark-gray paragraph borders under major résumé headings.
- The exact supplied name casing and Unicode characters are preserved. Contact
  text stays in the document body; email and portfolio values have visible,
  validated hyperlink targets.
- Résumé employment headers use a two-line title then employer/date/location
  treatment. Displayed date ranges use an ASCII hyphen. Generated prose rejects
  en and em dashes.
- The résumé summary is natural prose and no longer adds a `Target role:` banner.
  Substantive verified history may produce a two-page résumé without deleting
  required experience.
- Cover letters require three or four supported paragraphs, job/company
  specificity, two to four evidence points, a correct salutation, and an
  unbolded signoff.
- PDF is selected before DOCX when both formats are allowed. A safe explicit
  employer filename instruction takes precedence; otherwise filenames use the
  locked candidate/artifact/company convention. Explicit names reject control
  and bidirectional-format characters, trailing dots/spaces, and Windows device
  names.
- The editable DOCX source is retained in the private operator-drafts bucket
  even when PDF is selected for customer delivery. Its path, hash, size, MIME
  type, and filename are bound into the immutable artifact provenance.
- A missing employer page limit remains unspecified rather than being silently
  converted to one page. Concise complete cover letters are accepted; the
  250-350 word range is guidance rather than a fabricated minimum.
- PDF metadata uses the candidate as author and binds the exact company and role
  in title and subject. Generated DOCX packages reject hidden text, unsafe
  relationships, drawings, text boxes, tables, headers, footers, comments,
  tracked changes, and prompt artifacts.
- Production renderer readiness now requires actual Arial bytes and a matching
  SHA-256. The AWS worker image accepts a licensed Arial TTF only through a
  BuildKit secret and fails closed on font fallback.
- PDF structure validation checks the actual tagged hierarchy, including the
  document root, headings, paragraphs, links, and native list/list-item/body
  structure rather than treating the presence of isolated tag names as proof.
- Forward migration `202610030066_locked_document_generation_standard.sql`
  disables prior material-generation approval until the Arial renderer is
  reapproved and records a launch checkpoint. Migration
  `202610030067_document_source_and_rollback_compatibility.sql` preserves the
  prior compatible renderer contract for forward-fix rollback, requires the
  private editable source for newly generated artifacts, enforces only explicit
  employer page limits, and restores advisory-lock-first capacity rollover.
  Migration 067 is preserved byte-for-byte as first committed. Forward
  migration `202610030068_historical_document_access_only.sql` carries the
  nullable editable-source guard correction and separates supported historical
  download access from current-only approval and release validation. No
  published migration is rewritten by the final change. Forward migration
  `202610030069_durable_delivered_document_access.sql` keeps the 24-hour source
  freshness rule on approval and release without turning it into an implicit
  expiration clock for an otherwise valid paid delivery.
- The isolated worker is capped at 512 MiB in both infrastructure and runtime
  validation. The AWS budget defaults on and requires both launch-alert email
  recipients.
- Customer and operator access accepts the locked Arial contract and the
  immediately preceding immutable Liberation Sans contract, with exact
  version-to-font matching. New approval and release actions still require the
  current locked contract. The operator queue labels historical files as
  access-only and disables their approval and release actions. Commit
  `d61331eb951a34a7a23fb33e51d319d0ed2283fc` is the minimum rollback target
  after migrations 066, 067, 068, or 069, provided migrations 068 and 069
  remain applied.
- Failed deletion of a private editable source is inserted into the existing
  maintenance cleanup queue; a queueing failure is surfaced instead of being
  silently discarded. A delayed cleanup intent is now written before upload and
  cleared transactionally by artifact registration, so a process crash cannot
  leave an untracked private DOCX indefinitely.

## Local acceptance evidence

- Lint: passed.
- Type checking: passed.
- Unit/integration suite: 85 files, 604 tests passed.
- Production build: passed on Next.js 16.3.8.
- Production dependency audit: zero vulnerabilities.
- Database contract fixtures: 12 passed.
- Database types: match the local migrated schema.
- Historical-data upgrade fixture: passed.
- Rollback-compatibility fixture: passed; local schema restored through all 74
  migrations.
- Browser matrix on the preceding document-alignment commit: 301 passed, 24
  intentional project-specific skips, zero failures across desktop Chromium,
  Firefox, desktop WebKit, mobile WebKit, and mobile Chromium. The corrective
  delta covered server-side provenance, validation, infrastructure, and SQL; it
  did not change the customer interface.
- Real local render QA: seven artifacts across eight pages; searchable tagged
  PDFs, exact extracted text, metadata, structure trees, and visual page review
  passed. Arial file SHA-256:
  `b3658eadae55e682b5f69eb64c439c1ecc8f196c0bb8d4756d145d13bc86476a`.
- Final render evidence directory:
  `evidence/applypack-chunk5-render-20261003-193535`.
- The tracked render manifest
  `docs/evidence/DOCUMENT_RENDER_MANIFEST_2026-10-03.json` binds the local
  artifact hashes and toolchain to source commit
  `91469cd8920670aa80f6cbb717ceef21f9322ba7`. The binary evidence remains local
  and ignored by Git.
- The later access/cleanup compatibility commits do not change generated
  document bytes; the manifest remains bound to the render-producing source
  commit named above.

## Required human and hosted proof

The locked standard requires judgment that cannot be truthfully replaced by a
unit test. Operators must still verify factual accuracy, chronology, job-map
coverage, natural language, visual hierarchy, employer instructions, working
links, and final PDF appearance before release. Native Microsoft Word/Arial,
commercial parser behavior, and assistive-technology behavior are not proven by
the local LibreOffice render.

Production AWS KMS and isolated-renderer attestation, hosted staging journeys,
three-account isolation, real payment/refund canaries, maintenance and alert
evidence, backup restoration, manual accessibility testing, permitted real-job
inventory rehearsal, tax approval, production migration/deployment, exact-SHA
health, and supervisor signatures remain separate launch gates. Until those
gates pass, the only accurate launch verdict is `NOT READY` and checkout must
remain locked.
