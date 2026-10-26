# Confirmed intake and service-error correction protocol

Date: 2026-10-25

Status: **SOURCE IMPLEMENTATION IN PROGRESS — NOT HOSTED-VERIFIED OR LAUNCH-READY.** This document defines the intended workflow. Implemented source components and their local checks are recorded in the [progress ledger](../launch/IMPLEMENTATION_PROGRESS_2026-10-25.md); they do not establish that the deployed forms, database, generation pipeline, public terms, or support routes enforce this complete protocol. Purchasing remains subject to the existing launch gates.

Authority: [October 25 confirmed-intake and service-error amendment](../applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md). Preserve the [one-off retention amendment](../applypack/18_OCTOBER_24_ONE_OFF_RETENTION_AMENDMENT.md), historical accepted terms, payment obligations, truth rules, and human approval requirements.

The planned prospective identifiers are `confirmed-intake-v1` and `service-error-only-v1`. Terms `manual-launch-terms-2026-10-25-v4` and Privacy `privacy-2026-10-25-v4` are reserved, not runtime-active contracts. Their eventual accepted receipts must bind the final exact content and versions. Do not relabel existing v3 orders or rewrite earlier receipts.

## 1. Service boundary

The system helps the customer assemble and confirm an accurate background, finds suitable jobs, and drafts application documents. The owner reviews exceptions, approves the final ten jobs, and approves every delivered document. Customers review their information before final submission; they are not expected to rewrite generated documents or repair system defects.

The included post-delivery remedy is for a qualifying error ApplyPack introduced relative to the information confirmed for that service. It is not a general editing, updating, or revision service. A wrong number the customer confirmed, an omitted role the customer later remembers, a new qualification, or a changed preference does not automatically entitle the customer to replacement documents or regeneration of every purchased pack.

The current agreed prices remain $18.99 for exactly ten reviewed jobs and $7.99 per selected job for a tailored resume and cover letter. The planned no-resume intake uses those same prices when evidence sufficiency passes before payment; it is not a separate product or surcharge. Preserve existing capacity, invitation, delivery, refund, replacement, and access rules. This protocol does not create an automatic refund or a new revision product.

## 2. Adaptive intake: complete enough, without an unnecessary questionnaire

Use a shared set of sections with conditional questions, plain language, saved server-side progress, and a visible review stage. Ask about actual tasks in the context of a particular past role rather than showing a long unexplained skills checklist. Reuse already confirmed answers. Explain why a follow-up matters and permit an honest unknown when it can be handled without a false claim.

| Entry path | What the system does | What the customer confirms |
| --- | --- | --- |
| Current resume | Extracts draft facts, identifies ambiguities, and proposes relevant questions | Contact information, role history, dates, responsibilities, capabilities, qualifications, and preferences |
| Outdated resume | Uses the upload as a starting point and asks what changed or is missing since it was written | Ended/current roles, later work or training, changed contact details, and the accuracy of older claims |
| No resume | Builds the same structured background through guided sections and task prompts | Actual employment, business/freelance work, education, projects, volunteering, caregiving or other relevant experience, without requiring invented formal titles or achievements |
| Career change | Keeps the factual history intact and asks about desired work, transferable tasks, supported breadth, and constraints | What the customer has actually done, can do now, wants to do next, and has not yet learned |

These paths may overlap: a career changer may have an outdated resume or none. They must converge on the same confirmation and evidence standards. A file upload is not mandatory in the planned no-resume path; a sufficient truthful background is. Do not represent that path as implemented while the current form still requires an upload.

### Identity and contact

- Ask for the name to use, account/contact email, and the contact information the customer wants on application documents. Distinguish account sign-in information from document contact information.
- Present phone numbers and email addresses exactly for final review. Validation may catch obvious formatting problems; it cannot certify that a number belongs to the customer or silently change its digits.
- Preserve names, accents, apostrophes, hyphens and customer-confirmed capitalization. Do not infer a full street address when city/state is sufficient for the approved document.
- Treat optional links as optional. Do not invent a LinkedIn URL, portfolio, website or professional profile.

### Work and relevant experience

For each applicable role or experience, collect the actual organization or project, relationship/title, approximate dates with their precision, current/ended status, and meaningful responsibilities. Ask for tools, scope, training and outcomes only when relevant. Ordinary customer-supplied facts are usable evidence; do not demand documentary proof of every normal work-history detail.

Examples of targeted follow-ups include: “What did you usually handle in that role?”, “Did you do this yourself or help someone else?”, “Did you supervise people, train them, or coordinate their work?”, and “What happened when a customer had a problem?” Avoid turning one answer into several unsupported claims.

- Distinguish informal team support, training new colleagues, shift coordination and formal people management. Do not infer “team lead” from seniority or invent a direct-report count.
- Preserve approximate dates. Do not fabricate a month, continuous employment, or years of proficiency to make a document look complete.
- Distinguish completed, in-progress and expired credentials. Confirm an actual required license rather than inferring it from a workplace.
- Relevant projects, unpaid experience and caregiving can demonstrate tasks when accurately described; do not relabel them as paid employment or solicit unnecessary medical/family details.
- Metrics are optional. Ask for a supportable amount only when useful; accept a qualitative description instead of inventing percentages, revenue, volumes or team sizes.

### Contextual task-level skill questions

The following are examples for adaptive question design, not an exhaustive occupation taxonomy or automatic skill assignment. Suggested prior duties must come from the customer's actual prior role/activity context and stated tasks, not the desired future occupation. A desired job or unresolved requirement may separately prompt an unasserted capability question such as “Have you actually done this?”, with not-done/unsure choices. Never attach that task to a past role without confirmation.

| Past-role context | Plain-language prompts | Distinctions to preserve |
| --- | --- | --- |
| Retail or customer service | “Did you handle returns, take payments, answer complaints, or train new staff?” | Cash handling is not bookkeeping; helping a colleague is not automatically supervision |
| Office, scheduling or administration | “Did you arrange appointments, keep records, prepare documents, or track deadlines?” | Entering data, checking accuracy, coordinating a process and owning that process are different |
| Hospitality or food service | “Did you coordinate a shift, handle bookings, manage stock, or resolve guest problems?” | Serving customers does not establish sales targets, food-safety certification or management authority |
| Warehouse, delivery or logistics | “Did you receive items, scan stock, check orders, plan routes, or investigate missing deliveries?” | Using a scanner does not establish inventory planning, commercial licensing or equipment certification |
| Billing, bookkeeping or finance support | “Did you enter invoices, collect payments, match transactions, or investigate a discrepancy?” | Record entry, reconciliation, analysis and regulated financial advice are separate activities |
| Healthcare or care support | “Did you schedule visits, maintain records, coordinate services, or explain a process?” | Administrative work must not imply clinical practice or a license; omit unnecessary patient details |
| Education, training or volunteering | “Did you explain tasks, prepare materials, track progress, or organize activities?” | Helping, tutoring, classroom teaching and formal teaching credentials are not interchangeable |
| Trades, maintenance or field work | “Did you diagnose problems, follow work orders, document repairs, or coordinate supplies?” | Assisted work differs from independent diagnosis; do not infer licenses or safety certifications |
| Self-employment or freelance work | “Which services did you provide, and did you schedule work, invoice clients, or handle delivery?” | Business ownership alone does not establish staff management, revenue or every business function |
| Technology or support | “Did you resolve tickets, configure software, investigate failures, or write code?” | Following instructions differs from independent troubleshooting, administration or software development |
| People leadership | “Did you assign work, train staff, review performance, or make hiring decisions?” | Ask about the actual authority and scope; do not turn coordination into formal management |

For spreadsheets, ask concrete questions such as entering and formatting data, sorting/filtering, formulas, lookups, pivot tables, charts or cleaning data. For business systems, ask what the person did with the system: entering records, finding information, handling tickets, reporting, importing/exporting, or managing permissions. Only ask about SQL or system administration when relevant.

Response choices must distinguish “I can do this now,” “I have done it but need a refresher,” “I have only basic exposure,” “I have not done this,” and “I am unsure.” Ask for a brief example when it resolves a material ambiguity, not as a compulsory essay for every skill. A job title or a desired future career never establishes proficiency.

### Desired work and practical constraints

Capture preferred responsibilities, work to avoid, supported search breadth, and optional titles/industries. Separate interests and flexible preferences from hard restrictions. Ask work mode, location, employment type, compensation basis/period and relevant work conditions in plain language.

- Hybrid/onsite choices require applicable commute inputs and a supportable commute check. Remote-only answers must not inherit hidden commute restrictions.
- A pay number requires a clear hourly/annual period and base/guaranteed-total meaning. Invalid text must not leave an older number silently active.
- For a hard criterion that employers may omit, ask how missing employer information should be handled without waiving an actual disqualifying requirement.
- Ask what a custom dealbreaker means when it cannot safely become a concrete filter. Do not guess from an ambiguous phrase.
- A career-change request can broaden to supported transferable tasks with consent. It cannot establish qualifications the customer lacks, guarantee a new career, or silently remove hard restrictions.

## 3. Parsing, provenance and evidence sufficiency

Resume extraction creates suggestions, not confirmed facts. Keep each suggestion tied to its document version and source location, with the parser version and review state. Treat uploaded documents and external text as data, not instructions. The no-resume path records customer statements as their source instead of creating fictional document citations.

Use explicit states for unconfirmed extraction, customer-confirmed information, rejected information, corrected/superseded information and unresolved contradictions. A current explicit correction may supersede stale resume text; retain the provenance of that decision. A prior AI-written resume is not independent proof of its claims.

Before final submission, ask targeted questions for material gaps or conflicts, including:

- contradictory dates or whether a role is current;
- a claimed credential whose completion/status is unclear;
- an ambiguous supervisory responsibility or tool capability;
- missing contact information needed for the chosen delivery;
- incompatible pay units, location or hard preferences;
- insufficient background to evaluate the requested work honestly.

Show the specific fact and explain the decision it affects. Do not repeatedly ask answered questions or hide an answer after a network failure. Allow the customer to go back to the relevant section rather than sending them through the full form again.

Evidence is sufficient when the customer has knowingly reviewed the material facts and the system can perform the requested service without inventing information. Not every optional field needs an answer. An honest unknown may remain if it is explicitly excluded from claims and handled conservatively in matching. If the remaining uncertainty prevents a credible service, hold feasibility/invitation and explain the unresolved need before payment. Do not force a fabricated answer or accept payment on the assumption that the owner can fill gaps later.

Customer critical facts must be clarified before final submission whenever foreseeable. An employer-specific uncertainty discovered during later research may require a narrowly targeted question. Any answer that changes confirmed facts follows the versioned re-confirmation process below; it is not a silent edit to the original snapshot.

## 4. Full review, section editing and final confirmation

Before final submission, provide a complete, readable review of the information that will govern the service. It must not be only a short generated summary. Show contact details, each relevant experience, dates and their precision, responsibilities/capabilities, education/credentials, desired work, constraints, unresolved optional unknowns and relevant permissions. Distinguish customer-confirmed facts from excluded/unconfirmed content.

Every section has an accessible Edit action. Editing returns to that section with existing answers intact; saving returns to the review. The customer may correct or add information freely during this pre-confirmation process. Do not describe these ordinary intake edits as a post-delivery correction entitlement.

When an edit changes a dependency:

1. Preserve the prior draft revision and validate the edited section.
2. Clear or revalidate only dependent derived answers, fact confirmations, questions and draft matching conclusions; retain unrelated valid answers.
3. Surface any affected assumptions or new targeted questions.
4. Show the updated full review and require confirmation of the resulting version.

Replacing a resume must not silently merge obsolete claims into the new one. Resolve conflicting values, stale extracted facts and duplicate experiences before confirmation. Changing a preference must not alter historical facts. A stale browser tab must not overwrite a newer version without an explicit conflict-resolution path.

Final submission records an immutable, customer-confirmed snapshot with its owner, version, content digest, referenced document/fact versions, displayed review version, confirmation timestamp and applicable accepted legal receipt. Downstream research, invitation, payment and document models must bind to that exact snapshot. Do not treat a save button, page visit, inferred approval or timeout as confirmation.

After confirmation, a requested fact change creates a new draft/version. Explain which future or unstarted service may use it and what needs renewed review. Never mutate a paid order's confirmed snapshot, silently change its deadline, invalidate delivered history, or apply new information to every purchased pack. Before payment, changed material inputs invalidate stale feasibility and invitations and require reassessment. After payment, route the impact to the operator under the accepted service contract; no automatic rework, extra charge or new product is created by this protocol.

## 5. Drafting and owner approval

Generate private drafts only from the bound confirmed facts, current approved target-job evidence and approved instructions. Every substantive claim must be traceable to that evidence. Tailoring may select, order and accurately phrase relevant facts; it may not invent credentials, convert limited exposure into expertise, or change the customer's history to match a job.

Use accessible employer application questions as additional job-specific evidence under the [employer-question protocol](EMPLOYER_APPLICATION_QUESTIONS.md). A question about handling competing deadlines can guide selection of the customer's confirmed scheduling experience. It does not establish that the customer has that experience or turn a question into a mandatory qualification. Record the exact job, question, source and any access limitation; never imply an unseen application was fully inspected. The owner reviews how these clues shaped the resume and cover letter before approval.

The owner checks factual accuracy, appropriate coverage, job alignment, readability and the rendered document before delivery. A source upload or generated draft is not an approved deliverable. Preserve the approved model, artifact/revision identifiers, job target, confirmation version and approval record. Customer delivery occurs only after the required human approval; retrying generation must not bypass review or publish a new revision automatically.

## 6. Service-error triage

Use the terms accepted for the affected order first. For the new prospective policy, keep the existing three-calendar-day reporting window and one grouped request boundary, narrowed to qualifying ApplyPack service errors. The implemented contractual timezone and deadline rules must remain explicit. A failed attempted fix stays within the same open case; it does not become an unrestricted revision round or a reason to close an unresolved service defect.

The customer identifies the delivered item, the incorrect passage/detail and the expected correction. They need not draft the replacement prose. The operator compares the artifact with the exact confirmed snapshot and bound evidence used for that service, not merely the customer's latest profile.

| Report | Classification and response |
| --- | --- |
| ApplyPack changed a confirmed correct phone digit, name, date or title | Qualifying service error; verify the original confirmed value and prepare a scoped repair |
| Customer confirmed the wrong phone number and later provides the correct one | Customer-input change; no automatic included repair or regeneration of past packs |
| Customer omitted a team-lead role/responsibility and reports it after delivery | Newly supplied information; no automatic entitlement. Do not infer it from the former title |
| Confirmed evidence already establishes a material responsibility, but ApplyPack's output materially misrepresents it | Investigate as a possible service error; compare the exact evidence, intended claim and delivered wording |
| A true fact was not selected for a tailored resume | Not automatically an error. Tailoring does not promise inclusion of every supplied fact; distinguish material omission/misrepresentation from an editorial preference |
| ApplyPack invents a qualification, employer, metric, skill or target company | Qualifying service error; stop affected pending delivery, correct the unsupported claim and examine related artifacts |
| Customer wants a different tone, layout, strategy, new target job or newly acquired skill included | Outside the included service-error remedy; no automatic rework or new paid offering |
| The confirmed source is missing, ambiguous or conflicts with the artifact | Keep the case unresolved for evidence review. Do not invent an audit trail, automatically blame the customer, or label it a proven service error without support |
| An attempted repair still contains the accepted service error | Reopen/continue the same case and correct the failed repair before declaring it resolved |

Keep triage classifications clear: confirmed service error, customer-input/new-information change, editorial request, historical-contract remedy, or evidence investigation. Forward096 supplies reporting and decision records; forward099 supplies scoped repair versions and immutable releases. Their presence does not activate the new terms or establish hosted acceptance. Record the reason and evidence references without putting resume content into routine logs or analytics. Explain the outcome plainly and without accusatory language.

An account contact update for future communication is distinct from altering the confirmed content of a past paid pack. Receiving a customer report must not automatically change all stored facts, regenerate files, trigger delivery or create a refund.

## 7. One service defect, all actually affected artifacts

If ApplyPack introduced a confirmed error, inspect all related delivered packs and pending drafts that used the same erroneous value, evidence transformation or generation defect. The affected set is established from provenance and artifact inspection, not simply from customer identity or the fact that several packs were purchased.

1. Record one case with the confirmed source fact, defect, affected order/revision IDs and accepted scope.
2. Check each potentially affected resume and cover letter. A pack with the correct information is not regenerated.
3. Repair every artifact confirmed to contain the same qualifying service error, while preserving its job target and unaffected approved content. Do not use the repair to add unrelated new information or rewrite all packs.
4. Produce a new private revision with explicit lineage to the erroneous one. Never overwrite the historical approved record or its acceptance evidence.
5. Re-run content and rendered-file checks, then obtain owner approval for each repaired delivery. There is no automatic customer-facing regeneration or auto-delivery.
6. Notify the customer which items were corrected, make the approved revisions available through authorized private access, and resolve the case only after delivery is confirmed. Reconcile partial failures and retries without duplicate delivery.

If one accepted grouped request identifies multiple genuine service errors, triage their scope together. Do not require separate customer reports for every file carrying the same confirmed defect. Equally, do not expand an accepted defect into a general right to update unrelated packs.

Preserve timely open cases, paid obligations and required information under the applicable retention contract. Holds protect evidence but do not automatically reopen access. Approved correction delivery follows the applicable access-window rules; it does not restart optional purchasing or create a fresh unlimited correction entitlement. Do not promise recovery of already lawfully removed content or authorize protected-archive access, restoration or deletion through this support protocol.

## 8. Historical contracts and release controls

Existing customers retain the terms and correction rights recorded with their paid orders. The new narrower policy must not be applied retroactively by a deployment, login, profile edit, new purchase or re-consent. A customer may have historical and prospective orders at the same time; triage each affected order under its bound receipt.

The later implementation must align intake review, snapshot binding, consent, checkout copy, FAQ, customer support forms, admin triage, generation lineage, notification content, access rules and database constraints. Reserved version names alone do not activate the policy. Final exact legal content and receipts must be reviewed and bound before new purchases use it; preserve historical receipts and published migrations.

This document authorizes no deployment, provider change, paid provisioning, customer communication, credential replacement, cleanup/redaction executor, restore sanitizer, or archive-pruning action. Existing separate authorization and launch gates remain in force. No customer-ready claim follows from publishing this protocol in Git.

## 9. Acceptance evidence required for implementation

Before marking this workflow implemented, demonstrate:

- Current, outdated and absent-resume paths converge on equivalent confirmed evidence without fabricated facts or a no-resume surcharge.
- Career-switch prompts identify real transferable tasks, preserve missing qualifications, and ask contextual rather than universal skill questions.
- Unknown dates/metrics and optional answers remain honestly unknown; material ambiguity generates a targeted clarification before confirmation/payment.
- Every review section is editable; changes invalidate affected dependencies, survive interrupted saves, and return to a complete review.
- A final snapshot cannot change in place; research, invitation, paid order and document approval retain the correct version across later edits.
- Customer-confirmed wrong phone, newly supplied team-lead history and later skills do not trigger automatic included repair or all-pack regeneration.
- A generic checkbox or count-only review cannot establish that parser-introduced wrong contact details were knowingly confirmed. Verify the exact displayed values and editable review version before attributing an error to the customer; otherwise investigate.
- ApplyPack-introduced wrong phone, invented claim and material misrepresentation do trigger scoped service-error review.
- Omitting an irrelevant true fact is distinguishable from a material omission; operator decisions retain supporting provenance.
- The same service defect in several packs produces approved repairs for all affected artifacts, leaves unaffected ones unchanged and survives partial failure without duplicate notification/delivery.
- A failed repair remains an open case; reporting bounds do not become an unlimited subjective revision loop.
- Historical terms and prospective terms coexist correctly; customer ownership, private access, retained evidence and minimal financial history are preserved.
- Keyboard, screen-reader, zoom/reflow and physical-phone checks cover the full adaptive intake, review edits and error-report flow.

Record source implementation, local/CI evidence, hosted sandbox end-to-end evidence and human operator acceptance separately. Until those stages are completed, the status remains **incomplete and not launch-ready**.

## 10. Connected repair controls in the source candidate

The source candidate connects the following owner steps. These are instructions for acceptance testing, not a claim that the deployed service is ready:

1. Inspect the reported issue against the original confirmed evidence and delivered file. Record which original files actually contain a confirmed ApplyPack error.
2. Open the accepted repair for the affected pack. The saved version binds the accepted scope and current evidence; it does not authorize file creation or delivery.
3. Save corrected content for the selected files, or retain the original content when only rendering needs repair. Keep unrelated content and original customer facts unchanged.
4. Review every statement and its evidence. Changes require a new version and fresh checks. A saved correction alone does not approve its wording.
5. Explicitly create the corrected files after wording review. Only the selected files are prepared. If a response is uncertain, use the saved-result check; absence of a registration receipt does not establish that an upload never happened.
6. Preview the prepared files, record visual approval, and choose the separate Send action. A successful earlier step never automatically approves or sends a file. Check uncertain approval or Send results against their exact saved request.
7. Verify that the customer's portal shows the released replacement for each affected original, with its own access deadline. Unaffected files remain available under their existing rights. An expired replacement is unavailable individually and does not restore the defective original or hide an active companion file. An already delivered repair remains available while a later repair is being prepared, subject to current access and consent.

Customer feedback on a failed repair and owner case resolution are a separate unfinished connection. Resolution must cover the complete accepted affected set and must not overwrite feedback received since the owner last reviewed the case. The pending forward102 check addresses that race. Keep the case open until that connection and the full delivery journey are verified. New v4 terms remain inactive.
