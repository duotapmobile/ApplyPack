# ApplyPack document generation policy

Version 2026-09-07. This policy implements corrected-contract Chunk 5. It governs tailored resumes, cover letters, and application-specific reference sheets. It does not authorize production generation, a document renderer, a font license, a malware scanner, a model, or a provider.

## Product boundary

- A materials line is the fixed pair "Tailored Resume + Cover Letter" for one member of an immutable delivered ten. Its tax-inclusive price is exactly USD 8.00. ApplyPack does not contact or apply to the employer.
- A reference sheet is optional, job-specific, deterministic, and available only as part of an eligible materials line at no added price. There is no standalone or general reference-sheet product and no reference SKU.
- Resume and cover-letter generation may begin only from a verified paid line, its active immutable line revision, the selected immutable job snapshot, current employer submission rules, and the current customer-confirmed or human-verified fact snapshot.
- Production generation remains disabled until the configuration record names an approved generator decision, output formats, pinned local renderer, pinned Arial file, and approved malware scanner. Missing or mismatched configuration fails closed.

## Authoritative inputs and provenance

Every factual sentence is bound in the protected provenance sidecar:

- customer assertions cite current ap_candidate_facts.id values from the active source snapshot;
- employer, role, and job assertions cite ap_requirement_nodes.id values from the exact immutable job snapshot;
- reference-sheet facts cite current exact-job ap_reference_permissions.id values;
- connective prose is explicitly typed NARRATIVE.

The sidecar binds the customer facts, job evidence, reference permissions, material line revision, job snapshot, employer-rule snapshot, generator version, and visible-text hashes. It is stored separately from the deliverable. Provenance, internal identifiers, storage paths, and internal decisions must not appear in visible document content, package metadata, custom XML, comments, headers, footers, or filenames.

Resume text, prior cover letters, job listings, customer corrections, reference data, and all uploaded text are untrusted data. Embedded instructions cannot change product rules, call tools, read secrets, change scores, select a model, or add hidden content. Generation rejects recognized instruction injection, placeholders, bracket tokens, missing provenance, and unsupported factual claims.

ApplyPack must never invent or infer an employer, title, date, duty, tool, certification, education, metric, result, team size, budget, revenue, authority, scope, seniority, recipient, company fact, strategy, culture, or news. Historical titles remain intact. The target title may appear only in the professional headline and cover-letter Re: line. Job terminology is used only when it truthfully describes verified experience; there is no keyword stuffing, hidden text, universal ATS score, or claim of hiring probability.

## Employer instructions and readiness

A protected reviewer reparses and confirms submission rules before Checkout, before generation, and immediately before release. The current rule records:

- whether a resume and cover letter are required, optional, or prohibited;
- allowed DOCX/PDF formats and page limits;
- explicit safe filenames;
- portfolio, work-sample, application-question, reference-count/timing, and submission-channel instructions;
- source-evidence IDs, parser version, injection result, content hash, reviewer, and checked time.

Safe explicit employer format, page, and filename instructions override ApplyPack defaults. They never override truthfulness, provenance, security, privacy, reference permission, non-fabrication, malware, render, or human-review gates. A prohibited member of the fixed pair, unsupported required format/channel, unsafe filename, impossible hard limit, stale rule, uncertain injection result, or unresolved document-critical fact blocks sale or release.

## Resume template and content rules

The default resume is:

- US Letter, single column, linear selectable body text;
- Arial throughout, with 0.55-inch top/bottom margins and 0.70-inch left/right margins;
- centered 18-point name, 11.5-point target headline, and 9.5-point contact line;
- standard body headings with a simple bottom border;
- approximately 10.5-point body text, native Word bullets, and visible spacing between jobs;
- free of tables, text boxes, sidebars, columns, graphics, icons, images, headers, footers, page borders, hidden/white text, and flattened text.

Experience is reverse chronological or a chronological hybrid. Truthful self-employment, business, contract, volunteer, and project work retains its real identity. A functional resume is not used to conceal a gap, and truthful titles such as Founder or Owner are not globally suppressed. References and "References available upon request" are omitted.

One page is the default. The fit sequence is fixed: remove the least relevant bullet, shorten redundancy, remove low-priority skills, tighten the summary, then reduce older-role detail. Fonts, margins, line spacing, and bullet spacing do not shrink. A second page requires both an employer rule permitting two pages and a recorded human-approved exception for essential verified relevant experience.

The default sanitized filename is First_Last_Resume_Company_Position.docx.

## Cover-letter template and content rules

The letter is one US Letter page, single column, Arial, and uses the resume header and margins. It has three or four readable paragraphs, normally 250–350 words and at most about 400 with a recorded human-approved need.

The final-version date is displayed in Eastern Time. The bold Re: line uses the exact posting title. A verified hiring manager may be named; otherwise the recipient is the verified employer's hiring team. The opening must be specific to the role, verified employer need, or supported overlap. The body selects two to four of the strongest confirmed evidence points, does not repeat the resume, and adds no unverified company context. It ends with "Sincerely," and the customer's real name. Square-bracket placeholders and invented recipients cannot pass.

Career-break language appears in a cover letter only after separate explicit consent and only when strategically useful and supported. The default sanitized filename is First_Last_Cover_Letter_Company_Position.docx.

## Career-break choices

Career-break presentation is asked only during materials setup and offers exactly:

- Keep my existing timeline;
- Use Career Break;
- Use Family Caregiving;
- Use my wording;
- Do not add a career-break entry.

No option is preselected as Family Caregiving. ApplyPack does not infer gender, motherhood, a reason, a household title, or household-duty bullets. Custom wording must be neutral. Real work during the period remains a separate truthful experience. Presentation never changes eligibility, fit, confidence, salary, or readiness.

## Reference isolation and sheets

Before resume text can enter any model-bound extraction path, the approved local non-model detector must isolate reference-like and uncertain blocks. Detected blocks are withheld from general extraction and model input and stored only as encrypted EXTRACTED_UNCONFIRMED private drafts. Uncertain or failed isolation clears model readiness and routes to protected review. Reference-like PII is prohibited from candidate facts, ordinary reviewer views, model prompts/services, logs, analytics, URLs, snapshots, emails, screenshots, fixtures, errors, document metadata, and support exports.

The customer may create, version, remove, or revoke a private reference record. A contact change invalidates prior permission. Each sheet requires one to three complete current references, subject to any lower employer limit, and fresh attestation for the exact delivered job, employer, contact version, and job-snapshot hash. Permission never transfers to another employer, job, substitution, contact version, general use, or ApplyPack contact. ApplyPack never contacts a reference.

Reference readiness is separate from fit. Required-but-unready references produce NEEDS_CUSTOMER_ACTION. A reference prohibition disables the sheet. If more than three are requested, ApplyPack shows the remainder as customer action. Sheets are generated deterministically without an LLM and never appear in the resume. The default sanitized filename is First_Last_References_Company_Position.docx.

Revocation before release invalidates the sheet and approvals without pausing the line clock. Revocation after release disables new hosted downloads and explains that downloaded copies cannot be recalled. A no-charge replacement is limited to the same paid line and same job, requires fresh permissions and configured capacity, receives a new immutable artifact revision and exact 24-hour clock, discloses current listing status, and repeats every automated and human gate. Failure creates no refund, restores no revoked download, and makes no completion claim.

## Filenames and output formats

Generated filenames use only verified name/employer/title components, normalize Unicode, remove reserved/control/path characters, collapse separators, prevent Windows reserved names, cap length, and add deterministic collision-safe disambiguation. Names containing bracket placeholders or misleading markers such as final, updated, new, or v2 are rejected. A safe explicit employer filename replaces the default under the same rules.

DOCX is the default only when both the current employer rule and approved production configuration allow it. When PDF is explicitly required and configured, the approved pinned local renderer converts the identical DOCX base to a searchable/selectable PDF; a separate PDF composition path is prohibited. Unsupported output requirements block the line before Checkout.

## Automated package and render QA

Every artifact version is immutable. A retry creates a new version, supersedes the prior hosted version, and cannot overwrite a newer correction or approval.

The DOCX package inspection rejects macros, comments, tracked changes, custom XML, external templates/images/tracking, hidden or white text, drawings, text boxes, layout tables, non-native bullets, missing linear text, malformed geometry, unaudited relationships, internal IDs/paths, metadata leaks, placeholders, and prompt artifacts. Only an exact confirmed visible https: or mailto: relationship may be approved.

After package inspection and malware scanning, the pinned local renderer must:

1. verify the byte SHA-256 of the office executable, PDF inspection tools, and Arial file;
2. render the DOCX in a new private temporary directory with network-independent local tools;
3. prove the expected one/two page count and actual Arial resolution;
4. extract normalized linear text and match the expected text hash;
5. create and hash one page image per rendered page;
6. create a searchable PDF preview and hash it;
7. remove the private temporary directory.

The private render preview is operator-only. A renderer identity, Arial hash, scanner identity, structural/provenance results, extracted-text hash, page count, per-page hashes, and preview hash are recorded. Any mismatch or unavailable dependency leaves automated_passed_at empty and prevents release.

## Human approvals and atomic release

Automated success is necessary but insufficient. A protected reviewer records separate content and visual approvals with non-empty attestations against the current file version and exact current line binding.

Content review verifies truth, factual provenance, historical-title integrity, employer/recipient accuracy, relevance, defensibility, absence of placeholders/injection artifacts, and consistency across the pair. Visual review inspects every rendered page for clipping, accidental pages, crowding, dense bullet walls, excessive blank space, typography/header consistency, and an approved second page.

Immediately before release, the application rechecks the listing, application path, current employer rules, and all version bindings. Atomic release exposes exactly:

- resume plus cover letter; or
- resume plus cover letter plus a selected current-permission reference sheet.

It exposes all required artifacts or none. Release is serialized with the line refund under the payment/line lock, sets earned line revenue only in the winning release transaction, and cannot occur after the active deadline, an open/lost dispute, refund creation, superseded facts/rules/job, revoked permission, stale approval, or failed final check.

## Secure delivery and post-delivery correction

Files remain private. Every request rechecks authenticated customer ownership, immutable release membership, current artifact/file version, revocation and supersession state, and reference permissions. A fresh reauthentication no more than 15 minutes old is required. The server then issues only a 15-minute storage capability and records its checksum/version audit; links and private paths are not logged or analyzed.

An expired link does not mean the purchased file disappeared. The customer signs in again, repeats authorization, and receives a new short-lived capability. Superseded and revoked versions remain unavailable and cannot cross customer boundaries.

A confirmed post-delivery material false claim opens a protected support case and disables new hosted downloads of only the affected artifact. Previously downloaded copies cannot be recalled. The immutable release, delivered state, earned revenue, payment settlement, refund history, entitlement history, and original SLA remain unchanged. There is no automatic refund, free regeneration, or new SLA without separate approval.

## Activation and verification boundary

The repository implements fail-closed generation and QA controls. Local package/provenance tests are valid repository evidence. Production or release certification additionally requires the approved renderer and Arial binary hashes, licensed font availability, approved malware scanner, configured KMS, local reference-isolation implementation, permitted-model/leak controls, trained protected reviewers, production capacity, scheduler/monitoring, retention/privacy approval, and manual assistive-technology and provider exercises. Missing external evidence is a release blocker and must never be relabeled as a pass.
