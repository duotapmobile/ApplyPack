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

Identity/upload/demographic fields are excluded from tailoring. Heuristic or unsupported omissions leave a partial inspection, including ambiguous labels; ordinary experience questions about telephone work remain eligible. Observed questions are untrusted employer context and cannot manufacture candidate qualifications. The bounded draft proposal records which verified question influenced each passage, alongside the confirmed customer evidence required for its factual claims.

Question context is connected through the draft provider input, saved proposal claims and exact render source. The owner review screen displays each passage's specifically linked prompts, the job, capture time and available source link, with an anchor to the full inspection details. The wording-review control describes both the confirmed customer evidence and the question context. Missing, duplicate, ambiguous, malformed or quarantined linked observations prevent review, approval and Send; unrelated observed questions are not substituted. Raw question identifiers and inspection text do not enter the delivered resume or cover letter.

These are source implementation and local test boundaries. The configured collector supports authorized Greenhouse public job-detail questions; Lever, Ashby, custom application forms and gated or later conditional questions remain unsupported or unobserved as described above. A real provider comparison demonstrating question-driven emphasis, live authorized-source execution, human review of the actual complete document pair and the final hosted question-to-delivery journey remain required acceptance evidence.
