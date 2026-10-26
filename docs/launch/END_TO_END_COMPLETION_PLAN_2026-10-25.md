# ApplyPack end-to-end completion plan

Date: 2026-10-25
Status: working implementation plan; new intake/correction decision approved; launch NOT READY
Audit baseline: `25df9c54fa1bcdc2233f33933ad84e5ac870e597`

## Outcome and authority

The system finds candidate jobs and prepares complete tailored documents. The owner reviews and approves jobs and documents, handles support and decides when to launch. Customers supply and confirm facts through an adaptive intake, review every section before final submission, pay only when eligible/invited, and receive private approved deliverables. For new bound orders, ApplyPack remedies its own errors; customer mistakes, omitted/new facts and wording preferences do not automatically entitle document revisions.

Read [amendment19](../applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md), the [intake and service-error protocol](../runbooks/INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md), [paid-launch execution](../runbooks/PAID_LAUNCH_EXECUTION_2026-10-23.md), and [retention](../runbooks/ONE_OFF_RETENTION.md). Original handoff wording requiring a resume, manual authorship or a generic correction round is superseded prospectively. Historical contracts and evidence remain intact.

Keep Railway, existing prices ($18.99 for exactly ten jobs; $7.99 per selected pack), invitation purchasing, one search/two packs per rolling 24 hours, the actual 24-hour clocks, private delivery, no subscription and no auto-apply. Keep approved formatting, truthful claims and owner approval. Obtain a consolidated quote before new spending. The later consolidated preflight approved local implementation, fictional-data tests and Git publication for cleanup, database recovery and scoped protected-archive pruning; see the October25 approval entry in [implementation decisions](../evidence/IMPLEMENTATION_DECISIONS.md). Preserve existing backup drafts. Hosted deletion, deployment and new spending are not granted by that local approval.

## Completion scoring

Use an end-to-end agent score, not a percentage of files or tests written:

| Score | Evidence required |
| --- | --- |
| 0 | Required behavior absent |
| 1 | Started or partly connected; defects or missing steps prevent completion |
| 2 | Connected local workflow verified with realistic route-produced records and failures |
| 3 | Same release demonstrated in the hosted environment with actual dependencies |
| 4 | Production behavior verified and owner can operate the complete workflow |

Overall status remains **1/4 at the audit baseline**. A green CI run does not advance the service past a broken intake-to-delivery step. Score only applicable stages; record partial component evidence without averaging away blockers. Each implementation work item must name its owner, dependencies, exact source revision, acceptance result/evidence, remaining limitation and next action. Proposed work is not a completed evidence row.

Current local work is tracked in [the implementation progress ledger](IMPLEMENTATION_PROGRESS_2026-10-25.md). Its component checks do not replace the connected acceptance or final revision requirements below.

## Dependency-ordered inventory

For every stage below, define actor, input, output, durable state, authorized transition, retry/failure handling and observable completion. Codex owns implementation and evidence; the owner supplies the explicitly human reviews and final decision. The entries below are requirements, not passed checks.

1. **Product and policy contract.** Implement amendment19 prospectively; align legal receipts, support boundaries, historical contracts, retention mapping and actual UI. Freeze exact legal bytes only after provider/data-processing decisions are settled.
2. **Responsibilities and work ledger.** Distinguish customer, system and owner actions; record stage status and blockers; make exceptions visible instead of silently emptying queues. Preserve paid deadlines and obligations through failures.
3. **Existing resources and cost.** Verify named Railway, Supabase, Stripe, email, encryption and worker targets. Settle source/drafting/recovery choices and one itemized incremental quote before paid provisioning. Separate launch, real-customer variable costs and scale.
4. **Durable orchestration.** Bind intake revision, research, invitation, payment, selected job, draft, approval and delivery IDs; add bounded jobs, leases, retry deduplication, stale-result rejection, safe logs and concurrency protection.
5. **Public offer.** Align pricing, included outputs, invitation/capacity, timing, no-resume support, pre-submit review, service-error boundary and no guarantees across active copy and legal/support pages. Do not advertise unfinished capabilities as available.
6. **Private resumable intake.** Support saved progress, ownership/anonymous claim where applicable, network recovery, version conflicts, expiry and accessible step navigation. Avoid repeated questions.
7. **Upload or guided entry.** Accept a current/outdated supported resume or no resume; safely extract and show editable facts. Provide a usable unreadable-file fallback. Preserve versions/provenance and truthful validation labels.
8. **Background facts.** Confirm contact details, employers/titles/dates, duties, education/training/credentials, relevant unpaid activities and career-change context. Handle no previous job honestly. Distinguish missing, approximate and negative facts.
9. **Contextual skills and questions.** Suggest unchecked plain-language duties from each prior role/activity; allow none, custom duties and optional detail. Transfer only confirmed tasks into appropriate language; never infer management, specialist analysis, tools or metrics from a title or desired job.
10. **Work preferences and constraints.** Capture role interests, schedule, location/ZIP/commute, work mode, pay units/basis and dealbreakers; validate invalid/negative inputs visibly; resolve material unknowns without assuming willingness.
11. **Sufficiency, review and final submission.** Ask targeted missing/contradictory questions first. Show every supplied fact and selection on a section-editable page. Revalidate dependencies after edits. Confirm exact reviewed information/policy, freeze immutable receipt and block stale checkout. Reopen a new reviewed version for a pre-payment material clarification.
12. **Automatic research initiation.** Enqueue bounded research from the final confirmed snapshot; build the plan without requiring routine owner setup. Show progress, shortage and exceptions; limit unpaid research cost.
13. **Permitted source coverage.** Select usable sources, authorization, cadence and adapters for the initial service. Existing adapter code alone is insufficient coverage. Preserve provenance, partial runs and source-specific failures; never infer a listing closed from a failed/bounded scan.
14. **Listing normalization and verification.** Deduplicate employer/source/link identities; retain current listing and instructions; qualify unknown facts; ensure source revisions and permitted use remain traceable.
15. **Fit and feasibility.** Repair the route-to-database BLOCK mismatch; preserve commute origin and create real reviewed commute evidence. Apply hard criteria correctly, explain fit from actual facts, complete bounded coverage before declaring shortage and expose ERROR/LIMITED/INFEASIBLE states to the owner.
16. **Owner feasibility and invitation.** Present candidates and exceptions in a usable review queue; verify at least ten suitable opportunities, reserve capacity atomically and issue the customer/snapshot-bound invitation. No payment for an unsupported search.
17. **Search payment.** Charge exactly $18.99 through verified account/mode/catalog; bind final confirmed intake and legal versions. Signed/idempotent webhooks create the paid obligation and real deadline; handle retries, abandoned sessions, late events and reconciliation.
18. **Ten-job delivery.** Reverify all ten distinct jobs, get owner approval and release atomically. Do not pad a shortfall. Send private result notice once; apply the existing service-failure remedy when necessary.
19. **Customer selection and pack eligibility.** Show approved results, optional pack selection and applicable windows. Recheck job/instructions and necessary job-specific facts before checkout. Do not promise post-submission background changes will update past packs.
20. **Pack payment and drafting job.** Charge exactly $7.99 per eligible selected job with server quantity/capacity. Bind confirmed facts, job version, legal/correction policy, payment and deadline; durably initiate drafting once.
21. **Drafting evidence packet.** Provide only confirmed, relevant background and immutable job instructions; include supported education and career context. Collect accessible employer application/short-answer questions with exact source, time, version and access/completeness status. Bind their themes to confirmed facts as tailoring insight; label inferred priorities separately from explicit requirements. Resolve material gaps before purchase; paid exceptions go to the owner without resetting deadlines. Customers do not author finished paragraphs. Follow the [employer-question protocol](../runbooks/EMPLOYER_APPLICATION_QUESTIONS.md).
22. **Complete automatic writing.** Select/verify the provider, privacy, spend limits and structured-output contract. Generate full truthful resume and cover letter using provenance-bound claims; treat uploaded/listing text as untrusted content, not instructions; prevent unsupported embellishment.
23. **Draft execution reliability.** Handle crashes, retries, lost responses, concurrency, stale inputs and provider failures with bounded costs and operator alerts. Do not promise exactly-once provider billing without evidence. Do not register half a document pair as ready.
24. **Document rendering.** Use the existing isolated worker, approved pinned fonts and PDF/default-DOCX exceptions. Verify complete text/layout/accessibility and format instructions; protect and clean temporary files; preserve editable source for the defined owner workflow.
25. **Owner document workspace.** Notify the owner when the complete pair is ready; show readable content, private previews, provenance, job instructions and differences. Show exact employer application questions, observed limits, inferred priorities and which confirmed examples were emphasized; expose unavailable/partial question inspection. Provide review/edit-or-request-change controls without routine JSON. Paginate active work and show load failures distinctly from no work.
26. **Explicit approval and release.** Collect actual factual, content, visual and instruction checks; invalidate them after changes. Bind approval to exact versions. Owner authorization precedes atomic private release; do not hardcode attestations or allow automated customer delivery.
27. **Customer delivery and downloads.** Send private portal links, verify receipt, preserve ownership and useful fresh-sign-in return. Test customer mobile/keyboard access and correct file pair; disclose download expiry. The customer submits applications.
28. **Service-error triage and repair.** Compare the report against confirmed inputs and actual output. Customer typos/new team-lead claims/preferences do not trigger revisions. Investigate ambiguous parse errors; approve only actual service defects, inspect related affected packs, complete versioned repair/review/redelivery and close the case. Preserve earlier contracts and unfinished repair obligations.
29. **Job conflicts and replacements.** Keep preference dislikes distinct from a qualifying conflict. Update replacement job/evaluation/instructions/provenance together, protect paid child packs, avoid duplicates and preserve original delivery history and deadlines.
30. **Refunds, disputes and support.** Reconcile every payment/refund and preserve ordinary support while checkout is locked. Provide contract-aware decisions and delivery evidence; do not silently waive service-failure remedies or create a paid revision product.
31. **Access expiry and minimization.** Complete authorized cleanup/redaction and restore safeguards under the separate approval boundaries. Enforce 30-day access independently of cleanup; protect active paid work, qualifying timely cases, holds, historical/shared use and minimal financial/consent evidence. Do not treat a denied edit request as an automatic extension.
32. **Daily operations.** Verify actual maintenance cycles, queues, due dates, notifications, failure/staleness alerts and an independent detector for a stopped scheduler. Make pause/resume safe for paid work; monitor owner workload, costs and source/provider failure.
33. **Independent recovery.** Approve/prove a complete database/file/key/auth/configuration recovery arrangement with consistent checkpoints and current retention overlays. Demonstrate loss of the original machine/credentials, recovery within 240 minutes and no more than 15 minutes requiring recovery/reconciliation; reconcile Stripe.
34. **Connected acceptance.** Exercise real customer/admin routes, not hand-inserted fixtures alone. Cover each intake path, edits and clarification, research, exact-ten release, optional pack, truthful automatic drafts, owner review/delivery, both eligible and ineligible reports, failures, security, accessibility and physical-phone/human-document checks.
35. **Controlled release and first customer.** Review/freeze source, hold automatic deploy triggers, verify exact committed/final-main checks, prove recovery, apply only verified forward migrations, align staging and locked production, obtain fresh complete sandbox receipt, resolve independent reviews, obtain owner go-live decision and deliver a genuine first-customer pilot. A pack remains optional. Expand invitations only after review and within agreed capacity.

## Immediate implementation order and known defects

1. Build the prospective contract mapping and complete intake/review/sufficiency path first. Required regression cases include current resume, outdated resume, career switch, no resume, parse failure, wrong phone fixed before submit, unchecked skill, changed parent role and stale snapshot.
2. Repair matching's BLOCK handling, missing commute evidence, inaccessible feasibility exceptions and inconsistent replacement references while connecting automatic research through owner invitation and delivery.
3. Complete substantive automatic drafting, reliable complete-pair generation, owner workspace and explicit approval. Existing extractive preparation/manual JSON generation does not satisfy this outcome.
4. Replace the incomplete delivered-document correction path with contract-aware service-error review/repair. Test customer-input error denial separately from an ApplyPack-transcription defect and repeated failed repair.
5. Complete the separately authorized operations/recovery/retention work, accurate live copy, provider configuration and hosted acceptance before go-live. Documentation publication alone closes none of these runtime gates.

The latest connected audit adds explicit acceptance for two uncovered transitions: confirmed intake must durably start bounded research under an approved source policy without a manually prebuilt plan; material pre-payment clarification must create a successor draft, require a fresh complete review and prevent checkout or research against a superseded snapshot. Research failures and incomplete source coverage remain visible owner exceptions. Original confirmed snapshots and already-paid order facts must remain unchanged. These transitions are assigned to forward100 and101, respectively, after identifier verification; they remain incomplete until actual route-created records pass the connected scenarios. Forward099 scoped service-error repair is a separate workstream.

Forward098 archive coordination and the independent observer have local implementation and review evidence in the progress ledger. They still require exact candidate checks, generated declarations, provider permissions, hosted recovery/alert drills and the consolidated cost checkpoint. Retained database archives pin their dependencies; the current design does not claim bounded total archive storage.

## Remaining provider and launch decisions

- Drafting provider/model, actual customer-data handling and bounded cost; source coverage/cadence and reliable commute evidence.
- Internal service-error response/escalation target; preserve the existing reporting window without inventing a new delivery promise.
- Consolidated incremental quote and hosted configuration/execution approval for the proposed recovery and independent-monitoring resources. Local implementation/testing/publication approval is already recorded; it is not a pending question.

Owner wording edits now use labelled controls and confirmed source choices. Review and approval bind exact versions, and Send remains a separate explicit action. Those controls have published source and local/CI evidence in the progress ledger. The097 request-change component has local database, protocol and browser evidence; its adapter now uses actual generated declarations and connects the authenticated owner actions, page and maintenance workflow. Hosted owner/provider acceptance and the complete customer journey remain incomplete. Locked forward recovery remains the approved recovery strategy. These settled choices should not be presented as unanswered preflight questions.

The owner has already decided the system does research and drafting, supports no-resume/outdated/career-change intake, requires complete editable pre-submit review, and offers only service-error remedies for new bound orders. Do not reopen those decisions as unanswered questions.

## Intake and remedy implementation surface map

This is an observed source map at the audit baseline, not an implementation patch or a complete substitute for dependency tracing. Recheck paths when work begins. Existing immutable migrations are evidence of current behavior; change behavior through a new verified forward migration.

| Concern | Current source to inspect | Required connected change |
| --- | --- | --- |
| Resume requirement, contextual questions, pay validation and full review | `src/app/get-started/wizard-v3.tsx`; `src/lib/intake/four-step.ts` | Equivalent guided evidence without upload, role-based plain-language choices, accurate validation and full section-editable review |
| Questions arrive after finalization; answered state and network failure handling | `src/app/api/intake/anonymous-draft/questions/route.ts`; `src/components/intake/candidate-questions.tsx` | Pre-final sufficiency/clarification with saved answered state, material-gap decisions and recoverable failures |
| Finalization, immutable facts and legal binding | `src/app/api/intake/anonymous-draft/finalize/route.ts`; migration `202609040023_chunk2_four_step_intake.sql`; snapshot materialization/checkout consumers | Support guided facts at every layer; bind exact displayed review and fact versions, reject stale confirmations and prevent stale invitation/payment |
| Terms, FAQ, purchase and report wording | `src/content/public-pages.ts`; `src/components/portal/apply-pack-selector-v2.tsx`; `src/components/portal/material-deliveries.tsx`; email templates | Consistent prospective service-error promise, report-versus-entitlement distinction, complete-review notice and separate historical/account/privacy rights |
| Exact legal content and retention enrollment | `src/lib/legal/content-hash.ts`; migration `202610240087_one_off_service_retention.sql`; readiness, generated types and recovery consumers | Append a new exact-content contract and explicit retention mapping without modifying v3 receipts or existing migrations |
| Report currently consumes a request and revokes files | `src/app/api/customer/material-lines/[id]/support/route.ts`; migration `202609090035_material_correction_release_timestamp.sql` | Triage before remedy decisions; no blanket revocation or regeneration; historical rules remain supported |
| Incomplete post-delivery owner repair workflow | `src/components/admin/admin-operations.tsx`; `src/lib/materials/admin.ts`; material-line prepare/generate/release routes and approvals | Owner-readable report/evidence, scoped linked revision, complete pair, explicit checks/approval, atomic redelivery and true resolution |
| Regression evidence | `tests/unit/four-step-intake.test.ts`; `tests/e2e/chunk2-remediation.spec.ts`; `tests/e2e/chunk5-evidence.spec.ts`; `tests/integration/chunk5-materials-delivery.sql`; legal acceptance and retention fixtures | Actual connected route/data behavior; both fault origins; ambiguous parsing, all affected artifacts, failed repair, mixed historical contracts and accessible review |

Public runtime copy still describes the prior behavior. Do not label the application or public policies aligned until this map, the remaining stages and affected verification are completed. This plan began as a requirements baseline; implementation has since advanced through the published revisions listed in the progress ledger. New prospective legal terms remain inactive until their complete contract, runtime and repair workflow is verified.
