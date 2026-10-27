# ApplyPack Implementation Decisions

Last updated: October 25, 2026. Entries are chronological decisions/evidence; later forward decisions supersede conflicting earlier instructions without rewriting history.

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

## September 20, 2026 cross-chat authority reconciliation

The user requested recovery of updated searching mechanisms from other chats. The recovered September 9 final product amendment supersedes earlier no-subscription/manual-discovery statements in this record and older governing files. It is restored locally as docs/applypack/11_SEPTEMBER_9_FINAL_PRODUCT_AMENDMENT.md from the verified integration branch.

The employer-first assignment requires real verified jobs feeding both the neutral filtered board and the human-ranked Top 10 service. The observation-only foundation does not complete that assignment. Human review applies to Top 10, materials and policy exceptions, not every board listing. Reusable adapter/dataset approvals, authorized existing feeds, independent adapter rollout, measured relevance and bounded real/simulated cadence evidence remain requirements.

See CHAT_REQUIREMENTS_RECONCILIATION_2026-09-20.md for chat/attachment provenance and conflicts. JOB_SOURCE_REQUIREMENT_STATUS_2026-09-14.md remains the single source requirement/status authority. Original artifact recovered; full clause-level traceability remains pending. No runtime, payment, source activation, publication or deployment action accompanied these documentation corrections.

## September 20, 2026 master production implementation

The user's subsequent master directive authorizes ordinary engineering across discovery, sourcing, matching, human review, materials and delivery. It supersedes the document-only scope and the earlier manual-only implementation restriction. Production activation, paid external services and irreversible actions remain separately controlled by the user's directive.

- Preserve the existing stack, leased queues, structured truth layer, separate board/Top 10 products and human delivery gates. Do not create a parallel scheduler or opaque fit score.
- Source projection is additive and disabled by default (`APP_JOB_SOURCE_PROJECTION_ENABLED=false`). It may create hidden research candidates, never verification or customer-visible jobs. Local projection does not perform network requests. A schedule pause stops new collection; already preserved evidence may still be projected locally only while current source authorization remains valid.
- Unknown or negative candidate evidence cannot support an unqualified positive document claim. Exact verified wording is the conservative current guard; unsupported paraphrases fail rather than being accepted on UUID linkage alone. Employment and education fields must remain bound to the same record.
- Retire weaker generation/upload writes; preserve historical orders and files. A legacy document task requires explicit migration to a current material line before new generation.
- Keep the current centralized company-based filenames: the master's role-containing names are examples, not a requirement to override the earlier approved naming contract. Candidate-specific page rules remain separate from universal defaults.
- Native PostgreSQL validation is an additional engine test. Minimal synthetic auth/storage objects do not prove actual Supabase policy integration, provider credentials or hosted behavior.
- See MASTER_PRODUCTION_IMPLEMENTATION_2026-09-20.md for architecture, changed files, current counts, tests and subsystem launch verdicts. Keep docs/research/evidence local under the existing code-only publication instruction.

## October 23, 2026 sandbox Stripe continuation

The current sandbox handoff and October amendments control this change. Historical subscriptions, $20/$8 examples, and broad deployment instructions above do not authorize new products or public activation. New checkout remains hosted, one-time, USD 1899/799 cents, with automatic tax disabled and existing invitation/capacity controls.

- Require a non-secret `STRIPE_EXPECTED_ACCOUNT_ID` for new checkout. Retrieve the server credential's own account before current-price validation and after webhook signature/mode verification, before webhook database writes. Account lookup is bounded to five seconds and fails closed; deployment requires account-read permission on the actual server key.
- A present, mismatched webhook `account` is rejected. Ordinary direct-account events omit that field, so this check does not prove the configured signing secret belongs to the expected account. Provider verification of the exact endpoint/account/signing-secret combination remains mandatory. Do not add event retrieval merely to infer this: its 30-day retention would restrict historical replay.
- Preserve operational clients while checkout is locked. Historical order/cart webhook validation now uses `STRIPE_LEGACY_*` at the original 2000/800-cent amounts and permits inactive historical catalog entries, matching the existing versioned historical branches. Never substitute new price IDs for missing legacy configuration.
- Do not replace the existing staging credential or signing secret yet. Read-only inspection found historical completed sandbox payments, no corresponding records in the inspected staging tables, denied account/dispute reads, and unavailable migration-085 REST tables. An empty new account or bounded list cannot clear old-account obligations.
- Provider configuration remains unchanged. The current watched branch has `checkSuites=false`; publication could trigger deployment. The dirty tree and baseline HEAD are not approved staging candidates. Candidate, recovery, migration, and provider cutover preparation remain separate from local Stripe validation.
- See `STRIPE_SANDBOX_IMPLEMENTATION_2026-10-23.md` and `../runbooks/STRIPE_SANDBOX_RESTORATION_2026-10-23.md` for exact findings, configuration, validation scope, and remaining blockers. The original connection evidence and handoff are preserved unchanged.


## 2026-10-23: owner-approved sandbox proof and paid-launch execution

The owner explicitly approved implementation of the paid-launch plan and the forward amendment 17. Sandbox evidence plus a genuine first-customer pilot replaces mandatory live test payments/refunds. Preserve fixed totals, exact-ten search delivery, rolling capacity, invitation flow and 24-hour rules. Retire new production CANARY operations, retain staging testing, ordinary refunds and historical reconciliation. Require immutable versioned receipts, exact final SHA and verification within 24 hours of activation, through fresh administrator MFA.

The owner performs initial review/support and final launch acceptance. Recovery targets are 240-minute RTO and 15-minute RPO/reconciliation; locked forward recovery is the default. A consolidated incremental-cost quote must precede new paid provisioning; provider access alone is not cost approval. No paid CA or NAT gateway is assumed. Existing work was preserved in the ignored paid-launch evidence baseline before edits. No production-ready claim follows from local tests.

Recovery implementation follow-through: preserve the existing worker's short-lived temporary storage and add separate protected, versioned private-file recovery. The proposed database protection is seven-day Supabase PITR with independent owner recovery access; archive freshness alone does not verify database recovery, key/configuration custody or the full machine/credential-loss drill. Separate copy and retention capabilities, bounded two-pass source inventories and source-start heartbeat age support ten-minute warnings and a twelve-minute new-intake/checkout hold. Existing paid work, ordinary refunds and authorized access remain available. The current forward legal binding becomes privacy-2026-10-23-v2 for the actual processing/recovery disclosure, through still-unapplied migration086. Migrations through085, historical legal receipts and the historical rollback legal contract remain unchanged.

Automatic approval review blocked writing the exact-version archive deletion executor because explicit authorization for irreversible protected-version deletion was absent. No cloud deletion was attempted. A read-only planner and concrete scope are recorded in PROTECTED_RECOVERY_RETENTION_APPROVAL.md; explicit owner authorization is pending. The production retention service is quoted but not declared runnable. The next source publication is a review candidate, not the final production freeze or readiness declaration. Both deployment triggers are held. The single consolidated quote is PAID_LAUNCH_INFRASTRUCTURE_QUOTE_2026-10-23.md; no paid provisioning is authorized until it is approved.

## 2026-10-24: prospective one-off private-content retention

The owner explicitly requested updating code and policy documents locally and in Git for the agreed one-off service model. Amendment 18 controls: new accepted search orders use `one_off_30d_v1`, Terms `manual-launch-terms-2026-10-24-v3` and Privacy `privacy-2026-10-24-v3`. Original paid orders are not backfilled or shortened. Necessary payment/refund/consent evidence and account/contact records remain; no statutory financial-retention period is invented.

Customer access lasts 30 elapsed days after the latest approved delivery of the relevant search or paid pack. Optional pack checkout must be started and new covered match-conflict requests submitted within 30 days of the original search delivery. A durably started checkout keeps its original 35-minute expiry and idempotent recovery; never discard a verified payment just because its webhook arrives after the action cutoff. A timely open replacement or correction is completed even after that action window; its approved delivery refreshes access without reopening optional purchases. The existing one-round, three-calendar-day correction request rule remains. This bounded action window prevents optional future purchases from retaining private content indefinitely.

Active-system minimization covers source files, intake/profile content, customer-specific matching information, generated content and copies after all applicable access windows and obligations end. Unfinished paid work, timely requests, pending reconciliation, disputes, required holds, and shared historical/active entitlements veto removal. Access expiry remains independently enforced. Keep non-content receipts and minimal relational shells where financial and consent integrity requires them; never disable global immutability or delete payment history.

Recovery must exclude expired files and sanitize restored private database content against current expiry/deletion evidence before access opens. Backup exclusion is not physical archive deletion. Existing protected-archive executor authorization and hosted verification remain separate gates. The owner has deferred credentials and new paid resources; no credential rotation, spending, deployment, hosted migration, or customer/archive deletion is part of this local/Git update. A later new release SHA needs affected revalidation. See ONE_OFF_RETENTION.md for operator procedures and remaining hosted acceptance.

The current candidate implements prospective receipt binding, access expiry, protected shared obligations, operator holds, and recovery policy evidence. Automatic approval review rejected writing the local automated removal worker because authorization for its permanent-removal mechanism was not explicit enough. The owner was asked to authorize local implementation and tests only; no answer has been received. Object removal, private database-content redaction, and restore sanitization executors remain unimplemented. Migration087, new-policy checkout and activation deliberately fail closed on the missing cleanup capability. The separate protected-archive pruning executor is still outside that pending question. This candidate is not an operational deletion promise or a launch approval.

## 2026-10-25: confirmed intake and ApplyPack service-error boundary

The owner confirmed that the system must find candidate jobs and draft complete resumes and cover letters for owner review and approval. The later direct instruction requires low-friction but thorough intake for current/outdated/no resume and career changes, role-context plain-language skill choices with optional detail, targeted sufficiency/clarification before final submission, and a full page of actual information and selections with Edit controls for every section. Customer confirmation freezes that exact reviewed snapshot; it is not approval of a hidden count or generated summary.

For new contracts, ApplyPack repairs errors it introduced relative to the confirmed inputs. A customer-confirmed wrong phone number, omitted team-lead responsibility, new fact or wording preference does not automatically entitle rework of any or all purchased packs. Investigate ambiguous parsing/confirmation evidence; do not automatically blame the customer. A common ApplyPack defect must be checked and repaired across all actually affected artifacts, without rewriting unaffected packs. Keep the existing three-calendar-day reporting and one-grouped-request boundary; an accepted failed repair remains the same open case. Historical accepted rights, ordinary refund/dispute support and account/privacy updates remain separate and preserved.

[Amendment19](../applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md), the [intake/service-error protocol](../runbooks/INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md), and the [end-to-end completion plan](../launch/END_TO_END_COMPLETION_PLAN_2026-10-25.md) are the forward requirements. Their prospective identifiers are reserved, not runtime-active: `confirmed-intake-v1`, `service-error-only-v1`, Terms `manual-launch-terms-2026-10-25-v4`, Privacy `privacy-2026-10-25-v4`. A later forward migration must explicitly map new exact legal receipts to the intended retention/access policy because migration087 currently recognizes only the v3 pair. Preserve existing migrations/receipts and never activate new legal copy independently of matching runtime controls.

The audit baseline is full SHA `25df9c54fa1bcdc2233f33933ad84e5ac870e597`. The current implementation still requires a resume, displays a count-only fact review, derives skill prompts inadequately from prior duties, and lacks the complete automatic research/drafting/owner workflow and post-delivery repair path. Green component checks do not disprove these integration gaps. Required improvements are documented, not claimed complete. The overall connected service score remains 1/4 and launch remains NOT READY.

This turn authorizes local documentation and GitHub publication. It does not change runtime source, legal constants, migrations, providers, deployment or purchasing; it does not resolve previous backup/cleanup/archive permission boundaries. Existing uncommitted backup work is preserved outside the documentation commit. Original handoff bodies, locked formatting standards, historical amendments and accepted receipts remain intact, with forward authority notices linking the current policy.

## 2026-10-25: consolidated local-work and independent inbox-check approvals

In the subsequent consolidated preflight, the owner selected **Approve all local work** in response to the request to implement locally, test with fictional data, and publish to GitHub all three previously blocked components:

1. Policy-controlled customer-file deletion, private-data redaction and restore filtering.
2. Database backup and recovery.
3. Exact expired-version deletion in the documented ApplyPack protected AWS backup bucket, within the scope in [Protected recovery retention approval](../runbooks/PROTECTED_RECOVERY_RETENTION_APPROVAL.md).

This direct owner approval supersedes the earlier pending local implementation, fictional-data testing and GitHub-publication gates for those three components. The historical automatic-review denials and earlier unanswered requests above remain preserved as the record of their time. Approval does not establish implementation or test completion, and does not authorize hosted deletion, deployment or new spending. Hosted execution and final launch acceptance remain separate gates; existing uncommitted recovery work and payment history must be preserved.

The owner authorized independently checking the founder-authorized inbox for arrival of the discussed test messages and said they need not remain present. This records inbox-check authorization only. It does not establish authorization to send additional messages or prove provider acceptance, inbox arrival, email authentication, application sign-in, transactional reliability, support-reply capability or hosted readiness. Record observed results separately; no credentials or private forwarding destination belong in this decision log.

## 2026-10-25: matching summary and operator exception visibility

The matching runtime uses BLOCK as the fallback policy even on resolved PASS/FAIL gates. Serializing that fallback into the aggregate `unknown_treatments` made downstream database release checks reject otherwise eligible reviewed jobs. The aggregate now includes only gates whose actual result is UNKNOWN; full root/leaf evidence and hard-failure behavior remain intact. Actual blocked unknowns are not removed and historical evaluation records are not rewritten. Fresh evaluation and connected release validation remain required.

The owner queue must retain failed research, claimed work and completed LIMITED/INFEASIBLE findings after they leave PENDING. The admin view now uses bounded ordered pages, exact request-to-assessment bindings, explicit stale/missing notices and a distinct load-failure state. It does not infer that an unavailable queue is empty, retry a failed run, reserve capacity or authorize payment. Genuine guided intake is labelled using the original immutable snapshot's exact confirmation contract; missing provenance is not inferred to mean no upload. See [the implementation progress ledger](../launch/IMPLEMENTATION_PROGRESS_2026-10-25.md) for local checks and remaining gates.

## 2026-10-25: employer application questions inform tailoring

Direct owner instruction: inspect employer short-answer/application questions and use them as clues to improve and pinpoint the resume and cover letter. This is part of the automatic research, evidence-packet, drafting and owner-review workflow. It does not change product prices or add application submission or an answer-writing deliverable.

Record exact prompts and provenance, keep inferred emphasis separate from explicit employer requirements, and tie every resulting claim to confirmed customer facts. Show the questions and their influence beside the draft. Record partial or inaccessible forms honestly. Collection may use approved public interfaces and permitted navigation; no candidate data, screening answers, new application account or final submission is authorized by this decision. The [protocol](../runbooks/EMPLOYER_APPLICATION_QUESTIONS.md) defines implementation and acceptance. Documentation records the requirement; it is not proof of automated collection or hosted drafting.

## 2026-10-26: verified unpaid intake and clarification notifications

The owner's paid-launch acceptance explicitly requires sign-in followed by private intake. The intake protocol also distinguishes account/sign-in email from the contact email printed on documents. The older September3 anonymous Supabase-user/linking exception remains historical context; the current v3 browser-capability flow does not implement that linking model. A successful OTP login followed by an unrelated browser draft is insufficient proof of the agreed account-owned workflow.

The bounded implementation uses the existing email-code sign-in, verified non-anonymous account identity and possession of an existing valid draft capability. New empty intake creation and ownership binding must be atomic. Existing unowned intake requires an explicit verified claim with the expected access email; typed email alone never grants ownership. Preserve finalized source contents, foreign-account boundaries, paid conversion and historical access. Fresh-browser recovery lists only bounded summaries of already-owned unpaid intake and requires explicit selection before issuing an HttpOnly capability. It cannot silently choose the newest record, overwrite another browser draft, extend expiry or confirm a review.

Separate verified access identity from document contact information. Stable customer identity must remain bound through checkout and fulfillment even if account contact details later change, without rewriting historical snapshots or payment records. Integrate the new relationship with existing retention, restore locks, cleanup and protected recovery; unpaid ownership must not create indefinite retention or reset the current expiry. Do not revive frozen board claims or repurpose fields that mean paid conversion.

Question issuance must queue a generic, private-safe status notice through the existing transactional outbox. Recipients come from verified ownership, not editable resume text. Use durable event identity and the existing retry/dead-letter protocol, with no private question/answer content or authorizing token in the email. Account access, customer action and real inbox delivery remain separately verified outcomes. No real message is sent by implementing or testing these components locally with fictional data.

This resolves an implementation gap within the already approved launch acceptance; it is not a new business policy, provider account, paid resource or permission to change credentials. The uncommitted103 resume foundation is held for the coordinated ownership design. Any change creates a new source candidate and requires affected validation; its earlier isolated proofs remain evidence only for their recorded hashes. Published101/102 migrations, historical receipts and the existing paid portal remain preserved. Hosted migration, deployment, the consolidated cost quote and final go-live gates remain unchanged.
