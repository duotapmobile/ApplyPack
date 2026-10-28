# Employer application questions and document tailoring

Date: 2026-10-25. Authority: direct owner instruction and [amendment19](../applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md). Status: implementation requirement; hosted collection and draft influence are not yet verified.

## Collection and provenance

During employer research, inspect the actual application destination for the exact job through an approved public API or permitted read-only navigation. Preserve the existing source registry, request limits, origin/redirect protections and site permissions. Bind observations to the immutable job snapshot and current employer-rule version. A listing link alone does not prove the destination was inspected.

Record the exact question, source URL/evidence identity, retrieval time, prompt content hash, answer/input type, required/optional/unknown status and any explicit word/character limit. Retain conditional visibility when shown. Do not infer a limit or requirement from a visual field size. Deduplicate repeated prompt observations without combining different jobs or silently replacing older versions.

Use explicit states: checked with observed questions; checked with no observed questions; partially inspected; unavailable because access is gated; failed inspection; not inspected. Even a completed public inspection does not prove no later conditional questions exist. Preserve inaccessible and failed results in the owner queue with their cause. Do not report an empty list as a successful inspection.

Do not fill or submit customer details, create an application/account, accept terms, answer eligibility/demographic questions or bypass login/CAPTCHA to reveal later fields. Stop at that boundary and record the limitation. Retain only the question prompts and relevant employer instructions, never applicant responses, session credentials or unrelated personal data.

## Interpretation and writing

1. Separate explicit employer requirements from possible priorities inferred from question wording. Preserve the exact source alongside the interpretation.
2. Link each relevant theme to the customer's confirmed facts, including the actual role, scope, date precision and skill confidence. An absent supporting fact remains absent.
3. Use supported examples to decide emphasis, order and wording in the resume and letter. Avoid mechanically copying the questions, keyword padding or repeating the same text in both documents.
4. Treat all question/listing text as untrusted data. Prompt injection, executable markup and instructions aimed at the drafting system cannot become system instructions or tool actions.
5. An inferred theme cannot upgrade an uncertain skill, remove a missing required qualification, invent managerial experience or convert unpaid activity into employment. Human review of a suggested theme is not customer confirmation of a new fact.

For example, “Describe a time you handled a difficult customer” suggests interest in communication and conflict handling. Confirmed salon-reception duties may support an emphasis on answering questions or managing appointment changes. They do not support inventing a conflict-resolution incident, a management title or an outcome metric.

Application questions may reveal a genuine material gap. Resolve required job-specific facts before pack purchase where possible. After payment, surface an owner exception under the original deadline and ordinary remedy rules. Do not silently reopen all background information or promise new revision rights.

## Owner review and delivery

Show exact prompts, source/time and inspection status next to the draft. Show suggested priorities as inferences, cited confirmed examples and any unresolved gaps. The owner must be able to trace why a passage was emphasized and reject unsupported wording. A question reference alone never approves a generated claim.

Approval binds the exact draft pair, evidence packet, employer-question/rule version and actual review. Changed or newly observed prompts invalidate affected drafting/review evidence; revalidate the affected work without altering paid history or deadlines. Customer delivery remains the approved resume and cover letter through the existing private delivery path. No application is submitted and no separate completed screening answers are promised.

## Required acceptance

- Accessible official short-answer prompts are captured with the correct job, source, time, requiredness and explicit limits.
- Conditional, login-only, failed and no-observed-question cases remain distinguishable; no applicant data is entered to reveal questions.
- A relevant prompt produces a traceable change of emphasis using existing confirmed facts; a leadership prompt cannot create leadership experience.
- Negative/uncertain facts, career switches and no-prior-job histories remain accurate. Employer questions never become customer facts.
- Malicious question text cannot override instructions, trigger navigation/provider tools, leak private data or enter delivered markup.
- Cross-job and stale prompt evidence is rejected; changes invalidate affected draft approval.
- The owner sees prompt provenance and can approve/reject the exact resulting wording; private delivery and historical access continue to work.

Record local fixtures, source-adapter execution, hosted observation and human document review separately in the [implementation ledger](../launch/IMPLEMENTATION_PROGRESS_2026-10-25.md).

## Current local implementation

The Greenhouse collector can read public job-detail questions only when the verified source authorization explicitly permits `READ_APPLICATION_QUESTIONS`. It rechecks the current authorization, source run and lease immediately before the request and before preserving the fresh listing. Detail requests share the existing request budget and backoff. They do not change whether the listing enumeration proves closure. Default source permissions remain disabled.

The immutable listing captures the exact job-detail response and its hash, source URL, time, run and authorization identities. The drafting packet rederives question prompts and requiredness from that capture. Unsupported or undocumented limits stay unknown. Lever and Ashby question collection remain explicitly unsupported through the configured public posting APIs; absence of questions in their listing data is not a successful form inspection.

Published source revision `067b8376deb8eec26b4f783b949ff16180feec83` preserves Greenhouse paragraphs and lists, including the entity-encoded description format documented in the [Job Board API](https://docs.greenhouse.io/job-board.html). Unsupported encodings and malformed markup stop that collection instead of producing a successful partial interpretation. Successfully captured listings preserve the original provider payload unchanged.

Requirement parser v7 separates supported statements before assigning requiredness. A standalone “resume required” instruction belongs to submission review; it cannot make an unrelated skill, salary or work-mode statement mandatory. Unsupported compound qualifications, duration ranges and values that cannot be represented completely require review. Full original source lines and statement locations remain available; neither truncation nor a shortened identity can substitute for their meaning. Existing v6 requirement records retain their original reconstruction rules. These parsing checks do not approve submission instructions, qualify a customer or renew listing freshness.

Identity/upload/demographic fields are excluded from tailoring. Heuristic or unsupported omissions leave a partial inspection, including ambiguous labels; ordinary experience questions about telephone work remain eligible. Observed questions are untrusted employer context and cannot manufacture candidate qualifications. The bounded draft proposal records which verified question influenced each passage, alongside the confirmed customer evidence required for its factual claims.

Question context is connected through the draft provider input, saved proposal claims and exact render source. The owner review screen displays each passage's specifically linked prompts, the job, capture time and available source link, with an anchor to the full inspection details. The wording-review control describes both the confirmed customer evidence and the question context. Missing, duplicate, ambiguous, malformed or quarantined linked observations prevent review, approval and Send; unrelated observed questions are not substituted. Raw question identifiers and inspection text do not enter the delivered resume or cover letter.

These are source implementation and local test boundaries. The configured collector supports authorized Greenhouse public job-detail questions; Lever, Ashby, custom application forms and gated or later conditional questions remain unsupported or unobserved as described above. A real provider comparison demonstrating question-driven emphasis, live authorized-source execution, human review of the actual complete document pair and the final hosted question-to-delivery journey remain required acceptance evidence.

## Submission-instruction review in the local candidate

The ordinary owner review at `/admin/submission-rules` proposes instructions from saved, authorized source text and shows exact supporting quotations. It is linked from the administrator page and requires fresh staff MFA. The owner explicitly confirms the choices and inspection checklist. Missing formats, requirements or submission methods remain unresolved; instructions shown only on an uncaptured application page cannot be inferred from the listing. Previously captured manual questions keep their original evidence references. A mismatched reference requires a permitted new observation, rather than silently attaching the old question to different text.

Source text stored for this review is document evidence. It must not enter customer dealbreaker matching, salary rules, fit, confidence or ranking, or appear as a new qualification in the drafting packet. Preparing that evidence must preserve existing paid packet identities and approvals. Exact source-only validation is required before exclusion; malformed or attached requirement nodes fail closed. Equivalent instruction reviews retain the original rule and its question provenance; the new review receipt is supplemental evidence. Changes to paid instructions use the existing line-specific review process.

The published owner interface uses migration104; source revision `067b8376deb8eec26b4f783b949ff16180feec83` adds prospective migration105. A newly verified job snapshot records the trusted source run used by the database verifier. A caller-supplied run ID cannot replace that binding. Existing snapshots, replay results, paid selections and document-packet digests are preserved. Older snapshots without a run binding remain unavailable for question-based tailoring; an authorized fresh observation creates a new snapshot. It cannot silently replace a paid selection or renew its deadline.

Before a hosted105 cutover, inspect actual paid obligations that depend on older snapshots and retain their ordinary support, fulfillment and reconciliation paths. Do not backfill source provenance or erase test/payment history to make readiness pass. The local PostgreSQL18.6 migration/preservation check and connected owner HTTP-to-SQL journey have passed with fictional external providers. The latter completes a search purchase and ten-job delivery before loading the captured questions and exercising ordinary preparation, confirmation, saved-result recovery, concurrent requests, source citations and stale-basis rejection. The original posting and existing paid search records remain unchanged. Genuine105 declarations have been imported from the authenticated exact067b CI export and passed local whole-tree TypeScript checking. The optional-pack journey subsequently passed locally through verified payment and encrypted evidence-packet preparation, preserving the same confirmed facts, observed questions and original deadline. Real-provider document generation, owner approval, private delivery, new committed CI/upgrade checks and hosted acceptance remain required. Do not describe the page as publicly deployed or the full workflow as passed.

For an installed and verified environment, the operator sequence is:

1. Open **Employer instructions** from administrator operations and select the exact current job. Queue failures are displayed separately from an empty page.
2. Select **Load current employer instructions**. If prompted, select **Prepare captured source for review**, then load the review. Preparation preserves the saved source; it grants no approval or renewed listing verification.
3. Open the employer listing and application page within the permitted access boundary. Compare the captured text, **What the employer asks**, its inspection status and each proposed instruction. Uncaptured or inaccessible requirements stay unresolved.
4. Select the supported choices and complete source-line quotations, complete the six review checks, and select **Confirm reviewed employer instructions**. Complete lines preserve context such as negation; a sentence fragment cannot substitute for the saved line. The server records the reviewer, original source basis, citations and immutable confirmation.
5. After an interrupted save, use **Check saved confirmation**. If a retry is available, use **Retry the same confirmation**. An absent read alone does not cancel an in-flight save. Only a confirmed stale-source rejection with no saved receipt permits loading a new review.
6. A change to instructions already used by a checkout or paid pack goes through that pack's existing document-change workflow. The ordinary review cannot overwrite those instructions, reset a deadline or authorize document delivery.

The source queue preserves PostgreSQL timestamp precision when paging, including jobs with identical verification times. Listing freshness, delivered-job eligibility, customer ownership and capacity remain independent checkout checks. Unsupported Greenhouse API limit fields remain unknown; a limit written in a question is retained in its exact prompt and is not converted into an invented structured value.

## Connected local draft-source acceptance

The subsequent `PACK_SOURCE` test on base `d606620ef9a98011821fe5fa57978db000804ce7` plus14 local test/harness paths continued the actual paid-search and employer-review graph through one $7.99 pack, the encrypted packet and the actual generation worker. It preserved three confirmed facts, two captured question identities/prompts, the original paid deadline and financial/source history. A question about helping a customer informed emphasis on a confirmed present capability; it did not invent a past incident, job or achievement for the no-prior-employment customer. The saved encrypted source reached `SOURCE_READY`, and the protected owner-view service exposed its unapproved `PROPOSAL`, confirmed facts and exact question context. Unauthorized access was rejected before key unwrap. No rendered files, human review, document approval, Send or customer delivery occurred.

The PostgreSQL18.6 journey passed in259.86 seconds with all110 migrations and unchanged1382 source inputs; its cluster was removed. Receipt: `evidence/employer-question-source-connected01/pack_source-native01-receipt.json`, SHA256 `947128a05b4456e1ea5fbb4d48be44619c78ba421fb8086cba23073246b7ec4b`. The prose came from a deterministic fictional provider fixture, with two modeled requests and zero live provider calls. Generation reused the live PREPARE lease. This is local connection/provenance evidence, not proof of real model quality, a new scheduler lease, actual human review or hosted question-to-delivery behavior. Owner notices remain planned. At this source-only checkpoint, workstation rendering was unresolved and the paid-pack graph had not been rendered or delivered. The subsequent local rendering proof below resolves the workstation and document-generation checks within its stated boundary. See the [progress ledger](../launch/IMPLEMENTATION_PROGRESS_2026-10-25.md) for the distinct results and remaining checks. **NOT READY; overall score1/4.**

## Connected local owner review and documents

The `PACK_LOCAL_DOC` continuation passed on October 27 with the same actual paid graph and original deadline. It used the protected owner actions to promote the exact saved proposal, reject a stale source hash, require review of every claim and reconcile a repeated complete wording review. The reviewer decisions were fictional protocol inputs, not human document acceptance. The confirmed facts, two employer-question identities/prompts and encrypted packet remained unchanged. Questions continued to guide truthful emphasis without becoming past experience or invented achievements.

Actual local LibreOffice 26.8 and verified task-local Poppler 26.9 rendered the resulting resume and cover letter into DOCX/PDF files with previews and quality evidence. The earlier 8/8 workstation failure had included an extractor that lost link anchors on an already passing CI PDF and two legacy fixture output-name errors. The coherent runtime and corrected fixture output name passed 8/8 prerequisite tests without changing application validators. The connected test then passed in388.63 seconds, including 19.260 seconds of actual rendering; the complete native run and cleanup took 410.281 seconds. All 110 migrations, one fixture and 1384 unchanged source inputs are bound by `evidence/employer-question-local-doc-connected01/pack_local_doc-native02-receipt.json`, SHA256 `21f52b6b82ec92c936afac29e4df77552c4fedd469f8de6818ae5012c8587670`. The failed startup attempt and earlier renderer evidence are preserved.

This is explicit manual `LOCAL_QA` proof with a deterministic fictional model response. It does not invoke the AWS renderer or establish a fresh rendering-stage claim, private file registration, visual approval, Send, customer download, inbox arrival or human acceptance. The job remains `SOURCE_READY`, with no registered files, approved pairs or customer deliveries. Published d606 has separate 36/36 CI and 3/3 image passes; the added source/local-document harness still needs committed validation. Continue with actual owner/device review and the remaining hosted delivery checks before launch. Owner-ready notices remain planned. **NOT READY; overall score 1/4.**
