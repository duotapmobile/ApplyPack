# October 25 confirmed intake and service-error amendment

Date: 2026-10-25
Status: owner-approved product decision and implementation requirements; documentation publication authorized; new behavior is not yet implemented or deployed

## Controlling decision

The owner has approved a service in which the system finds candidate jobs and drafts complete tailored resumes and cover letters, and the owner reviews and approves both before customer delivery. Routine manual research, document authorship, or editing raw JSON is not the intended owner workflow. Source and drafting providers, coverage, privacy arrangements and spending remain subject to the existing launch gates.

Customers must have a low-friction but thorough opportunity to supply, clarify, edit and confirm their information before final submission. A current resume, an outdated resume, a career change and having no resume are all supported intake paths. A missing resume is not, by itself, a separate paid service or reason for rejection; enough confirmed facts must exist before a purchase can proceed. The agreed prices do not change.

For new orders bound to this amendment, there are no included general edits or revision rounds. ApplyPack remedies factual errors it introduces relative to the customer's confirmed information and the applicable job instructions. A customer-entered wrong phone number, omitted experience, newly claimed team-lead duty, new qualification, changed preference or request for different wording does not automatically entitle the customer to revised documents or regeneration of any prior Apply Pack.

This amendment supersedes conflicting manual-authorship, required-resume, generic factual-correction and post-submission background-update instructions in earlier documents. It does not rewrite earlier accepted terms or completed evidence. Amendment18 continues to govern retention/access; amendments17,16,14 and12 continue to govern their remaining launch, payment, capacity, delivery and formatting rules.

Operational detail: [Intake review and service-error corrections](../runbooks/INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md). Implementation sequence and completion gates: [End-to-end completion plan](../launch/END_TO_END_COMPLETION_PLAN_2026-10-25.md).

## Required customer sequence

1. Choose upload or guided entry, with an explicit way to say the resume is outdated or the customer wants a career change. These conditions may coexist.
2. Extract available resume facts into a private, editable draft. Display extracted values for confirmation; parsing is not proof of accuracy. If a file cannot be read safely, preserve draft progress and offer supported re-upload or guided entry, without inventing missing facts or making unapproved OCR/provider promises.
3. Capture name and contact details, work/volunteer experience, dates and current employment status, actual duties, tools, education/training, relevant credentials, and desired work and practical constraints. Reuse information already supplied. Mark optional and required inputs clearly. Do not demand a polished resume or finished cover-letter paragraphs from the customer.
4. Ask concise contextual questions about each relevant prior role. Suggest plain-language duties the customer may recognize, with no checked defaults and an explicit none/skip option where appropriate. Suggestions are questions, never asserted experience.
5. Let the customer select duties/skills and optionally describe an example, tool, result, frequency or responsibility. Request a specific clarification only when it is needed for a material claim or matching decision. Optional detail must not secretly become mandatory for every selected skill.
6. Check sufficiency and contradictions before final submission. Ask the smallest targeted set of missing or unclear questions, retain answered state, and rerun only affected checks after an edit. Clearly explain what is needed and why. Bound the process; if sufficient facts cannot be established, route to an owner-visible exception before invitation/payment.
7. Present one complete readable review page containing actual information and selected duties, not counts. Every section has an Edit action. The customer can fix a spelling, change dates, uncheck a skill, add detail or revise preferences without losing other sections.
8. Explicitly ask the customer to verify spelling, phone/email, employers, titles, dates, credentials and every selected responsibility. Show the no-general-revisions boundary before confirmation. There must be no surprise policy after payment.
9. Final submission freezes the exact reviewed version and acceptance receipt. Subsequent matching, invitations, payments, selected-job drafting, owner review and delivery must bind to that version. Finalization is server-validated, authorized and idempotent.

Autosave, resume-later, accessible labels, keyboard operation, useful validation errors, mobile readability and recovery from failed saves apply throughout. A blank field is not silently converted to a negative fact. Do not collect unrelated sensitive personal details simply to make intake appear thorough.

## Contextual skills and transferable wording

Generate suggestions from the customer's actual prior work context and confirmed tasks, not merely the desired occupation. Job titles can help choose questions but cannot prove that a task was performed. The customer can reject every suggestion or add a missing duty. Avoid stereotypes about what someone with a title or background must know.

| Prior context | Plain-language choices that may be offered | Permitted connection after confirmation | Unsupported inference |
| --- | --- | --- | --- |
| Salon reception | Answered calls; booked appointments; greeted clients; took payments; handled schedule changes | Customer communication, appointment scheduling, payment handling | Analyzed student data; managed staff; used a named scheduling product without confirmation |
| Retail or hospitality | Helped customers; handled returns; counted stock; opened or closed the workplace; showed new coworkers how a task is done | Service, issue resolution, inventory tasks, task-specific peer training | Held a manager title, formally led a team or increased sales by an invented percentage |
| Education support | Helped learners; recorded attendance; prepared materials; kept progress notes, if the actual role supports asking | Clear communication, record keeping, preparation and confirmed learner support | Performed statistical analysis or held a teaching credential without evidence |
| Unpaid caregiving, volunteering or projects | Organized appointments; coordinated supplies; kept a schedule; helped at an event, where relevant | Only the specific confirmed organizational or service skills | Paid employment, a professional credential, medical authority or a fabricated employer |

Translate a confirmed activity into truthful language relevant to another role. Do not upgrade scope, seniority, qualifications, tools or outcomes. Each reusable claim retains its source and the relevant role or activity; do not merge two jobs into a fabricated job history. Numbers, dates, names and credentials require exact evidence. Qualify approximate dates honestly rather than fabricating precision.

For outdated resumes, ask what changed since the document was written, whether a role is still current, and whether contact details, credentials or duties changed. For career changes, distinguish desired work from past experience. For no-resume customers, gather the same facts through guided entries and contextual choices, including an honest no-prior-job path. Do not manufacture credentials or experience to pass a sufficiency gate.

## Sufficiency and the final review

### Employer application questions as tailoring evidence

The owner's October25 follow-up requires the system to inspect accessible employer application questions, including short-answer prompts, while researching a selected job. These questions can reveal what the employer values beyond the job description. Preserve their exact wording, source, retrieval time, job/rule version, requiredness and any stated answer limit. Use them to choose emphasis and supported examples in the resume and cover letter, and show them beside the owner draft review.

An inferred priority is labelled as an inference. A question about leadership does not prove a management requirement or that the customer led a team. Match its theme only to confirmed customer evidence, retaining actual scope and role attribution. Do not invent an answer or transform a prompt into a qualification. Distinguish observed questions, a successfully checked form with none, a partial inspection, and an unavailable form; absence of captured questions is not evidence that no questions exist.

Collection follows the approved source permissions and access controls. Do not create or submit an application, send customer information, bypass authentication/CAPTCHA, or answer screening/consent questions merely to reveal later pages. Conditional or inaccessible prompts remain an explicit limitation for owner review. This adds tailoring evidence to the existing resume/cover-letter deliverable; it does not create a separate application-answer product. Protocol: [Employer application questions](../runbooks/EMPLOYER_APPLICATION_QUESTIONS.md).

Sufficiency is a documented decision, not a hidden word-count or requirement to choose a minimum number of skills. It must establish:

- Usable confirmed identity/contact fields and a coherent history appropriate to the customer; missing dates and conflicting sources are resolved or explicitly qualified.
- Enough supported experience, activities and preferences to assess the proposed search and later draft both documents truthfully without padding.
- All material matching constraints, with explicit unknown handling rather than assumed willingness or qualifications.
- Traceable evidence for intended claims, with no unsupported managerial, technical, numerical or credential inference.
- Completion of relevant questions and revalidation after edits. A skipped optional detail is not itself a failure.

The review page shows contact details, individual history entries and dates, education/training/credentials, selected duties with their associated roles and added details, volunteered activities, confirmed gaps or career-change context, desired work and practical constraints. Clearly distinguish facts from preferences and show only information actually collected or applicable. Do not leave hidden selected skills after their parent role or condition is removed.

Edits invalidate dependent questions, matches, summaries and unaccepted approvals as necessary. Preserve earlier versions for the applicable retention period; never silently patch an already-paid order's confirmed snapshot. If an owner finds a material ambiguity after submission but before invitation, reopen a versioned clarification and require a new complete customer review. Prevent checkout against a superseded snapshot. Required job-specific facts must similarly be resolved and confirmed before pack checkout; do not insert a blanket invitation to rewrite background after submission.

If a material gap is discovered after payment, surface an owner exception under the existing deadline and service-remedy rules. Do not quietly restart a 24-hour clock or turn a new fact into an entitlement to rewrite all past packs.

## Service-error boundary

| Request | Treatment for the new contract |
| --- | --- |
| Confirmed name was spelled correctly; ApplyPack changed its spelling | Eligible ApplyPack error; repair affected artifacts with owner approval |
| Confirmed phone number was correct; generated document has different digits | Eligible ApplyPack error; inspect other artifacts for the same defect |
| Customer supplied and confirmed the wrong number; output faithfully used it | Customer input error; no included document revision or automatic regeneration |
| Customer later says they also led the team, but never supplied/confirmed that responsibility | New information; no included rework of the existing order or earlier packs |
| Customer wants different tone, a new target or a new strategy | Preference/scope change; no included revision |
| ApplyPack adds an unsupported role, credential, metric or duty | Service error; owner must review, stop further use of the faulty draft and repair the affected output |
| A confirmed fact is materially misstated or lost through a processing defect | Service error; compare source, confirmed snapshot and artifact before resolving |
| Customer wants every supplied fact included in every tailored document | No such promise; editorial omission alone is not a factual defect unless it makes the result materially inaccurate or breaches the agreed deliverable |
| It is unclear who introduced a discrepancy, including a parsing defect | Owner investigation; no automatic denial and no automatic regeneration |
| Earlier order has a different accepted correction policy | Apply that recorded contract, not this amendment retroactively |

Retain the existing three-calendar-day reporting window and one grouped request boundary for the prospective service-error process. These are not a complimentary editing round. A failed or incomplete repair of an accepted service error stays in the same open case until resolved; it does not consume a new allowance. Do not promise an unapproved correction turnaround or treat the 30-day download window as the correction-report deadline. Exceptional late or disputed reports go to the owner; preserve existing refund, dispute, privacy/account-update and other applicable obligations.

A report alone must not cause automatic rewriting, all-pack regeneration or blanket revocation of otherwise valid downloads. The owner compares the exact delivered version, confirmed inputs, parse provenance and relevant job instructions, records a decision and identifies affected artifacts. Handle a confirmed harmful/wrong file through the narrowly scoped existing access-control procedure, while preserving the evidence and unaffected service.

Do not classify a parser-introduced value as a knowingly confirmed customer mistake from a generic checkbox or a count-only review. Establish that the exact value was displayed and could be inspected and edited in the complete review; otherwise investigate its origin rather than automatically denying the report.

For an accepted service error, inspect other documents produced from the same defect and repair each actually affected artifact. That scope is distinct from rewriting every pack for a newly supplied fact. Keep the original delivery and payment history, create a linked correction revision, rerun factual/format checks and owner approval, and release the approved replacement privately. An unresolved case protects necessary content from cleanup. Approved repair refreshes that pack's access under amendment18; denied or out-of-scope requests do not automatically refresh access, reopen purchases or grant more capacity.

Updating current account contact information is separate from modifying historical application documents. A customer can still raise an issue with support. An owner-approved courtesy exception must be explicit, bounded and recorded; no exception path, paid revision product, charge or entitlement is created by this amendment.

## Prospective versioning and rollout contract

Reserve the following identifiers for implementation; they are not active merely because this document exists:

- Intake confirmation: `confirmed-intake-v1`.
- Correction scope: `service-error-only-v1`.
- Terms: `manual-launch-terms-2026-10-25-v4`.
- Privacy: `privacy-2026-10-25-v4`.

Bind the final exact legal-content bytes/digests and intake receipt to the new checkout/order contract. Preserve the October24 v3 receipts and all older paid contracts. Do not rename v3 in place, edit published migrations through087, or infer acceptance from a login, date or site deployment. Recheck the next migration identifier before adding any forward migration during implementation.

Migration087 currently recognizes the exact v3 legal receipt for `one_off_30d_v1`. A new v4 legal page without an explicit forward enrollment mapping would bypass that recognized branch. Implementation must pair the new intake/correction policy with the same intended retention/access safeguards, update every checkout/readiness/type/recovery consumer, preserve historical contracts and reject unsupported or mixed version combinations. Existing paid orders and pending checkouts must retain their accepted versions through delayed payment, replay and later optional-purchase handling. Do not silently narrow an older search customer's promised pack terms; require explicit contract-aware eligibility/acceptance before any future purchase on different terms.

Update customer-facing pricing/FAQ/how-it-works/terms/intake/review/portal/support/email copy and owner controls together. The Privacy revision must describe only actual processing, providers and retention; provider selection and disclosures must be settled before legal-content freeze. No provider transmission, new paid provisioning, deployment, live activation, credential replacement or deletion authority is granted by this documentation update.

## Implementation gaps and required acceptance

The October25 audit found resume-required intake, a count-only final summary, inadequately contextual skill prompts, no complete automatic research/drafting-to-owner workflow, and an incomplete delivered-document correction path. Existing green component tests do not prove the intended connected workflow. Customer-visible source copy and runtime legal versions still implement older behavior until the tracked work is completed. This amendment is a required launch change, not an assertion that those gaps are fixed.

Acceptance must include actual route-created records and these scenarios:

- Current upload, outdated upload, career change, unreadable upload and no-resume paths all reach an accurate complete review without requiring a finished draft from the customer.
- Salon reception suggests relevant tasks without asserting unrelated education/data duties; customer rejection, custom duties, optional detail and plain-language transfer retain evidence and avoid invented seniority.
- Missing/conflicting facts trigger focused questions before final submission; edits can uncheck skills, change dates/name/phone and clear obsolete dependent answers; saved progress survives network errors.
- Concurrent/stale edits and replayed final submission cannot bind payment or generation to an unreviewed snapshot. Full review and confirmations are keyboard, screen-reader and physical-phone usable.
- A correct confirmed phone/name changed by ApplyPack gets a reviewed private repair; a customer-confirmed wrong value or newly added team-lead claim does not trigger free regeneration or an all-pack rewrite.
- Ambiguous parse errors receive review; an accepted repair that fails remains open; a common service defect is checked across affected packs without rewriting unaffected ones.
- Historical correction rights, applicable report windows, refund/dispute handling, current-contact changes, access expiry, retention holds, immutable receipts and no-resurrection recovery remain correct.
- System-created drafts reach a usable owner review queue; the owner can inspect facts and rendered files, approve or reject them, and authorize private delivery without routine JSON editing.

Final status remains **NOT READY** until implementation, exact-source verification, hosted journeys, human acceptance and the separate owner go-live decision pass.
