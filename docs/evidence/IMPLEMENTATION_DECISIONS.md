# ApplyPack Implementation Decisions

Last updated: September 2, 2026

## Confirmed by the owner

- Legal operator: DuoTap LLC d/b/a ApplyPack.
- Domain ownership: applypack.work is owned by the user.
- Repository: https://github.com/duotapmobile/ApplyPack.git.
- Hosting direction: Railway.
- Apply Pack capacity: two units per rolling 24 hours.
- Implementation authority: approved for the complete build.
- The supplied DESIGN.md and ApplyPack handoff control implementation.
- The owner selected exactly three domain addresses: orders@applypack.work for outgoing order mail, help@applypack.work for customer replies and public privacy/accessibility requests, and admin@applypack.work for administrative alerts and access.

## Safe defaults applied

- Search capacity begins at one 10-job search per rolling 24 hours.
- Next.js 16, TypeScript, and the App Router provide the web and server runtime.
- Supabase is the planned Postgres, passwordless authentication, private-storage, and RLS provider.
- Stripe hosted Checkout Sessions provide payment collection.
- Resend provides transactional email after domain verification.
- Customer login uses an email one-time code; admin authorization is separate and requires MFA.
- Source documents are retained for 30 days after completion unless deleted earlier under policy.
- One factual-correction round is available for three calendar days.
- Transactional email open and click tracking remain disabled.
- The launch remains manual-first for job research and document writing.
- No live charge, paid provider upgrade, or public legal placeholder is authorized merely by local implementation.

## Open external activation items

- Namecheap forwards orders, help, and admin mail to the owner-controlled destination inbox.
- Resend domain verification is pending DNS propagation.
- The root applypack.work Railway domain is verified with valid TLS; www verification is pending DNS propagation.
- The residential address remains private. A provider-specific public support-address requirement requires a non-residential founder decision.
- Tax classification remains unresolved and blocks the first live customer charge until written revenue-department guidance or qualified professional advice is recorded.
- The limited one-$20 and one-$8 live smoke test is authorized only after every relevant gate, with both charges refunded.

## Architecture choice

The repository was empty. The implementation uses a single Next.js application on Railway with server-only provider adapters and Supabase-managed persistence. This minimizes providers and keeps marketing, customer, admin, webhook, and scheduled endpoints in one deployable service while private files remain in provider storage.

The community app-builder template suggested Prisma and subscription billing. Those defaults were not adopted because ApplyPack uses Supabase RLS and two one-time purchases rather than subscriptions.

## September 2, 2026 job-source expansion

The owner's direct instruction approved bounded source automation and therefore overrides the earlier manual-only source-discovery restriction. Human review, exactly 10 delivered matches, no auto-apply, and manual document preparation remain unchanged.

- Only verified public Lever Postings endpoints for VIPdesk Connect and Five Star Call Centers are automated.
- All other approved employers are official-link-only, except notifyMD, which remains pending because no current official career source was verified.
- Indeed and HiringCafe remain explicit third-party compatibility/import sources; no unsupported scraper was added.
- Liveops is hard-excluded in normalization, database triggers, API/checkout filters, and tests.
- Blue Cross Blue Shield and AAA remain directories, not generic employers.
- The additive migration is forward-only. Production rollback uses application rollback plus provider restore or a reviewed forward migration so audit history is not silently destroyed.

The detailed source, classification, deduplication, filter, and operating contract is in `docs/job-search/SOURCE_EXPANSION.md`.

## September 2, 2026 orchestration completion

The owner's latest instruction requires automatic search kickoff and automatic document drafting while preserving admin review before each customer-facing release. This overrides the earlier manual-first rule only for discovery kickoff and first-draft creation.

- Verified payment queues work; the success page never fulfills an order.
- Search candidates and document drafts remain private until an MFA-protected admin reviews and releases them.
- Document drafting is first-party and deterministic from structured customer-provided facts. It does not send résumé data to a new AI provider and does not invent claims.
- The admin may edit the generated DOCX files and must upload and confirm the reviewed versions before customer delivery.
- Stripe remains in test mode, checkout remains disabled, and live payments require a separate explicit switch.
- Hosted ClamAV infrastructure is cost-bearing and requires owner approval before a Railway service is created.

## September 2, 2026 superseding launch clarifications

- Customer authentication is a branded six-digit email code; the generic confirmation-link callback is removed.
- Public identities are help@applypack.work, orders@applypack.work, and admin@applypack.work, using the smallest practical number of aliases or mailboxes.
- The zero-cost launch baseline uses strict document identity, structure, container, expansion, macro, embedded-object, active-content, encryption, private-storage, authorization, and retention controls. It is not represented as malware scanning.
- Stripe prices, quantity, currency, product status, webhook signature, payment state, refunds, and delivery claims are server-controlled and idempotent.
- Every search, Apply Pack, correction, and accepted replacement remains human reviewed before customer delivery.
- Existing Supabase rows are production data unless positively proven synthetic; no migration may delete or relabel them merely because they look old or incomplete.
- A completed delivered Job Match Search and a completed delivered Apply Pack are non-refundable. The post-delivery remedies are the eligible no-charge replacement and included factual-correction round. Only a duplicate or incorrect charge or a non-waivable remedy required by law may bypass the completed-work block.
- Refunds remain available only for genuinely unfinished work under the approved pre-work job-closure, missed-deadline, or inability-to-complete rules.
- Migration 024 preserves provider-linked checkout state during a stale customer retry so a delayed verified payment event cannot lose capacity or create replacement checkout state.
- Staging maintenance runs hourly as a short-lived Railway cron process in the existing project and records a private, content-free heartbeat. No always-on duplicate service was added.

## September 3, 2026 per-customer repeat exclusion

- The owner requires every later 10-job order for the same person to exclude every job previously delivered to that person.
- Launch identity scope is the same authenticated ApplyPack customer account. ApplyPack does not silently join accounts from a name, resume, or inferred identity.
- Migration 025 adds a private append-only delivery ledger and backfills existing delivered matches without deleting or relabeling production data.
- Initial matches and accepted replacements both append identity snapshots. Replacing a visible match does not erase the original listing from exclusion history.
- Operator routes preflight the complete batch and return a conflict response for reused listings. A customer-serialized database trigger remains the final atomic enforcement against races or alternate write paths.
- A genuinely new posting may qualify when its stable listing identity differs; the same listing may not be reused merely because a month has passed or its source presentation changed.


## September 3, 2026 founder-story page

The owner's direct instruction adds a new top-level public page titled “Why Apply Pack?” and supplies its founder-story copy. This expands the previously approved navigation and public route map without replacing the existing shorter About page.

- Route: `/why-apply-pack`.
- The new route is the first primary-navigation item and uses a visually distinct button treatment.
- The supplied copy remains first-person and preserves the founder's meaning. Obvious spacing, grammar, HTML-entity, and typographical artifacts were corrected for publication.
- The page repeats only the already-approved $20 search, exactly 10 selected jobs, optional $8 resume-and-cover-letter set, and no-subscription boundaries.
- The route is public, canonical, included in the sitemap and footer, and covered by public-route, responsive-overflow, and build checks.


## September 3, 2026 public-site copy and interaction correction

The owner's supplied correction brief supersedes the earlier public marketing copy, homepage section structure, generic secondary-page presentation, and decorative spacing rules. It does not weaken the verified pricing, timing, customer-control, human-review, no-auto-apply, or no-guarantee boundaries.

- The whole site uses Source Serif Pro for headings and Lato for body copy and controls. Heading ligatures are disabled, heading tracking is readable, and the default heading weight is 600.
- The controlling logo palette is #fdc403, #03ab63, #5a57e9, #fd9d02, #021185, #069fec, #2dd7fb, and #02d051. Bright colors use navy text when white would fail contrast.
- The homepage is limited to seven primary sections and uses the required match, experience, tailoring, and FAQ interactions with semantic keyboard controls and no hover-only disclosure.
- Public legal pages no longer display internal draft-status labels. Removing those labels does not represent attorney review or change the legal activation gate.
- The focused intake now starts with a rate-limited Supabase anonymous user. The same unique user ID owns the draft, private files, completed intake, capacity reservation, and order. The customer enters an email during intake, identity linking begins without blocking checkout, and the paid intake email is used for checkout and receipt delivery while verification is pending. Production requires Anonymous Sign-Ins and Manual Identity Linking to be enabled in the hosted Supabase project.
- The four-stage presentation groups the detailed questions into contact and documents, experience and direction, work fit and dealbreakers, and review and agreement. The review presents the service boundaries as plain text and uses one combined agreement checkbox.
- The prior dedicated /why-apply-pack route remains available because it was explicitly requested and published. /about carries the corrected concise founder story from the new brief, avoiding unsupported credentials.
- Customer-facing copy uses no em dash or en dash characters.
- Customer-facing labels use Tailored Resume + Cover Letter for the $8 item. The Stripe product configuration still requires a coordinated provider rename before its server-side name assertion can change; live payments remain disabled.

## September 3, 2026 refined process presentation

The owner's latest direct feedback replaces the compact, playful process controls and cramped generic How It Works hero with a restrained editorial presentation.

- The full stacked logo receives more vertical room and a larger, lower-left placement in the public header.
- Process and experience selectors use quiet surfaces, thin rules, restrained brand accents, explicit selected states, and no decorative checkmarks or inset novelty stripes.
- The homepage process heading is `Our Process`, with a directional arrow connecting `From unsure where to start` and `ready to apply.`
- The dedicated `/how-it-works` page now explains intake, capacity and payment timing, research, the complete 10-match delivery, customer selection, optional $8 application materials, truthful human review, customer submission, and the no-guarantee boundary.
- `/how-it-works` explains the operational journey. `/experience-connections`, labeled `How Matching Works`, remains focused on the reasoning used to identify credible experience and life-fit connections.
- `What it demonstrate` is corrected to `What it demonstrates`, with the caregiving example retaining the qualified wording `What it may demonstrate`.

## September 4, 2026 Chunk 2 oversight remediation

The oversight verdict supersedes the earlier Chunk 2 completion and accessibility claims until the remediation is implemented and reverified. The authorized start is `6256250693adefe2762a5f921c81fbfbcc305c75`; scope is Chunk 2 remediation and evidence correction only.

- Immutable intake snapshots now retain preferred work mode, preferred employment type, schedules, benefits, all work-condition preferences, and criterion-specific employer-unknown policies. A shared normalizer removes hidden or inapplicable title/preference state before save and finalization.
- A prior cover letter set to `NEITHER` is removed through the capability-protected document route; finalization also supersedes any still-current prior letter before downstream processing can use it.
- Extracted-fact corrections use a strict discriminated union. The database retains the category in `value_kind` and the category-specific fields in `typed_value`; the original extracted fact remains rejected and superseded for audit.
- Hard employer-unknown decisions are derived independently for dealbreakers, must-have benefits, and hard work-condition preferences. Namespaced keys prevent collisions.
- Review is divided into distinct human-readable sections, each with its own Edit action. Editing an earlier step returns directly to review after a successful save and retains the document record.
- Error summaries retain focus until the customer activates a link. Controls and groups expose stable adjacent error IDs through `aria-describedby`. Keyboard evidence traverses and operates the complete flow. The 200 percent assertion uses Chromium browser-engine metrics and explicitly does not use CSS `zoom`; automated checks do not claim manual assistive-technology certification.
- Migration `202609040024_chunk2_remediation.sql` is additive. Normal rollback reverts code/traffic while retaining the compatible schema; a destructive down migration remains prohibited without separate proof and approval.
- The Phase 0 bundle inventory is corrected to 14 regular files plus 2 directories, Chunk 3 through 7 boundaries are corrected, and full-file versus authoritative-body contract checksums are distinguished.

No provider was activated, no production database was changed, and no Chunk 3 work was started.

## September 5, 2026 Chunk 3 deterministic matching boundary

Chunk 3 replaces the corrected-contract path's implicit/title-led and caller-scored behavior with versioned evidence calculations while retaining the old point rank under explicit `rankLegacyJob(s)` names for historical paid/admin compatibility.

- Source access is default deny. Named employer, ATS, Indeed, HiringCafe, and retained Lever entries stay `UNVERIFIED_DISABLED`; no automated source is authorized. The repository records policy state and evidence but makes no legal determination.
- Responsibility-first retrieval preserves neutral families under title, industry, target-pay, and soft-avoidance changes. Search breadth expands only into verified nearby/adjacent/broad families and never grants speculative qualifications or points.
- Requirements retain Boolean structure, locators, excerpts, classification, confidence, corrections, and stable identities. Unknowns remain typed; active N/A is rejected; one deterministic passing alternative supplies required-branch denominators.
- Tool matching is task-level. CRM, reporting/BI, SQL, system administration, and spreadsheets are distinct explicit Boolean clusters. Posting-named tasks override generic clusters, and equivalent mappings need a version plus rationale.
- Only eligible and categorically useful jobs are scored. Fit is 35/25/20/10/10, preferences are an exact-fit-only equal-weight tie-break, confidence is separate 40/25/20/15, and readiness/presentation risk remain independent. Career break and other identity/proxy fields cannot alter these values by themselves.
- Deduplication uses the non-transitive pairwise graph algorithm and stores immutable membership/displacement evidence. Bounded diversity filters ineligible, evidence-insufficient, and Liveops records before applying the exact inclusive bounds.
- Feasibility owns immutable coverage plans and guarded request transitions. Missing authorization, required-family coverage, positive bounds, parser completion, normalization, manual checklist, or TTL/configuration cannot produce an outcome or Checkout.
- Migration `202609040025_chunk3_matching_engine.sql` is additive and legacy-compatible. Normal rollback reverts code/traffic and stops workers while leaving immutable expanded data in place.

This decision activates no source, Checkout, payment, production migration, push, merge, deployment, or Chunk 4 work. Production authorization, bounds, TTL, staff/monitoring, provider, retention/privacy, KMS/file-processing, and capacity dependencies remain explicit blockers.
## September 8, 2026 source inventory and guarded expansion

- The source audit found 69 database registry rows but zero source runs, jobs, or source references in both staging and production. No source is represented as successfully searched.
- The canonical job-source registry is distinct from the read-only master software-reference inventory and from supporting board-recommendation research.
- Duolingo, Ultimate Medical Academy, Brightwheel, ClassDojo, Capella University, Outschool, Stripe, Block, and Coinbase were reconciled. Stride's existing row was corrected and its exact Workday tenant recorded.
- Reusable Greenhouse and Ashby adapters were added alongside Lever. ATS support applies only to explicitly configured tenants.
- Every new structured source is unscheduled. Recurring source work requires both the environment gate and per-source schedule activation. Workflow attempts now record success and failure evidence.
- EdTech.com's fully remote page remains inactive and blocked because the audit client received HTTP 403 and no ingestion or paid-display permission was established.
- A reusable CSV intake and validator detects duplicate source IDs, URLs, and ATS tenants, requires permission evidence, and rejects scheduled activation for a new batch.

## September 7, 2026 Chunk 5 parser-audit remediation

The owner authorized correction of the Chunk 5 document templates after a supplied local and Affinda audit. The audit is diagnostic evidence, not product authority, and its embedded recommendations do not override the evidence-bound generation, privacy, provenance, or human-review rules.

- Generator version `applypack-evidence-bound-v2` uses real Word Heading 2 section semantics while preserving the approved visible Arial treatment.
- Resume job blocks use separate ordinary title, employer, and date/location paragraphs. Keep-with-next and keep-lines properties bind the block to its first content paragraph, and the page-fit estimate accounts for the additional lines.
- Experience defaults to stable reverse-chronological ordering based only on supplied date precision. A separately approved chronological-hybrid presentation may opt out; no month or date is invented.
- Career-break output remains separately authorized and is labeled as a non-employment timeline note in its own section so it is not presented as paid work or assigned an employer.
- Cover-letter generation fails closed when the opening is not specific to the verified target, a different title is described as the target role, or an eight-word sequence is repeated three times.
- Parser-review fixtures use realistic fictional names, organizations, month/year ranges, a non-ASCII name, varied substantive bullets, education, and target-correct letter content. The prior deliberately repetitive material remains historical stress evidence, not a writing-quality example.

The corrected seven DOCX/PDF pairs passed local XML, Mammoth, and pdfplumber checks: normalized DOCX/PDF text matched, every PDF page contained text, no page was image-only, resume headings converted to HTML headings, native Word lists remained intact, and the two-page resume kept every job heading with its first bullet. The PDFs resolved only Arial-family font names in the local inspection. This does not establish Affinda, Greenhouse, Workday, Lever, or universal ATS compatibility. A fresh external parser comparison remains required before structured-parser sign-off. The prior pinned renderer suite was not rerun because its `pdffonts` and `pdftotext` executables are no longer present locally; the corrected PDFs were rendered with installed LibreOffice and independently checked without relabeling that result as the missing pinned-renderer proof.
