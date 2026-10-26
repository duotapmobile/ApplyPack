# Material draft processing

Status: source integration in progress; not hosted or activated. Keep all three switches below false until the final committed revision, stage-specific database claiming, complete pair registration, owner controls and approved provider configuration pass connected acceptance. This runbook does not authorize spending, data transfer, migrations or deployment.

## Separate stages and authority

| Stage | Required input | Result | Human boundary |
| --- | --- | --- | --- |
| Prepare | Active paid obligation, exact confirmed intake/revision, permitted fresh job/instructions and current before-generation listing check | Encrypted immutable evidence packet | Missing or changed evidence requires clarification or an explicit fresh owner check; the scheduler does not manufacture observations. |
| Generate | Current packet, enabled immutable provider policy, reserved bounded spend and approved data handling | Encrypted unapproved writing proposal | No automatic promotion, wording approval or customer delivery. An uncertain provider result retains its reservation for reconciliation. |
| Render | Promoted exact source, complete explicit wording review, current evidence, approved isolated renderer/fonts and delivery-format decision | Complete registered resume/cover-letter set, plus the selected reference sheet, for visual review | Review, approval and Send remain separate. Reference support requires migration095 and connected acceptance; an insufficient mandatory reference count remains a clarification hold. |

Employer application questions are untrusted source evidence and tailoring clues. Keep their exact wording, source, observation time and completeness visible to the owner. Use only confirmed customer facts when responding to the employer's priorities; see [the question protocol](EMPLOYER_APPLICATION_QUESTIONS.md).

## Configuration

- `APP_MATERIAL_DRAFT_QUEUE_ENABLED=false`: overall background scheduling gate. Authenticated maintenance uses the typed stage-specific adapter only after file, encryption and source readiness checks. Default-off status does not add a new maintenance failure; an enabled but held, failed or uncertain stage is recorded as incomplete.
- `APP_MATERIAL_DRAFTING_ENABLED=false`: separate provider dispatch gate. The database runtime and immutable policy must also authorize the exact provider/model, privacy/evaluation/quote references and token/spend limits. A key's presence is not permission.
- `APP_MATERIAL_DRAFT_RENDERING_ENABLED=false`: separate rendering gate; it does not enable writing or sending. Renderer readiness, private encryption and current exact document evidence remain required.
- `OPENAI_API_KEY`: server-only provider credential entered through approved service storage. Never put it in browser configuration, source control, evidence bundles or chat.

Source-aware local rendering additionally requires the pinned `pdftohtml` executable and its hash. Linux worker image checks validate the corresponding isolated implementation. Existing approved fonts, paragraph/link checks, page previews and cleanup remain mandatory. A local fixture render does not establish hosted readiness or owner visual acceptance.

## Owner wording edits

The private workspace supports editing summary statements, skills, experience bullets and cover-letter sentences on the current saved source before Send. Confirmed identity/contact, factual headings, employers, dates, education and reference details remain read-only. The owner selects the actual confirmed supporting facts for revised wording; selecting a source does not establish that a claim is true. Negative/unknown qualifications and cross-role boundaries still apply. Owner wording is recorded as `OWNER_EDIT`, with the parent source/version and original provider-proposal lineage preserved.

Opening the editor clears local wording, approval and Send choices and locks other mutation controls. Cancel returns to the saved version with those choices still cleared. Save requires an explicit new-version confirmation. The server checks current paid scope, evidence, permissions, original contact and reviewer authorization, encrypts the new immutable source and appends it through the existing compare-and-set transition. Previous wording review, rendered members and approval do not transfer. The new version must pass wording review, rendering, visual/content approval and a separate Send.

A definite pre-storage validation rejection leaves the proposed wording editable and resets confirmation. An uncertain save freezes the attempted body and request ID in memory; **Reconcile saved edit** checks that exact request without an automatic retry or new identity. Private prose is never persisted in browser storage. After leaving or reloading the page, inspect the actual current saved version before editing again; do not infer success from a network failure. No edit operation calls the writing provider, changes customer-confirmed facts, approves or sends documents.

Requests for a further system draft are a separate implementation stage. They require durable encrypted owner instructions, exact parent binding and the existing cumulative attempt/spending limits. Local owner editing does not establish that this request-change stage, hosted administrator access or connected customer delivery is complete.

## Bounded queue contract

The orchestrator processes at most one claimed stage per invocation, preferring a ready render, then generation, then packet preparation. Its overall deadline is 150 seconds and it checks switches again after claiming. It returns only aggregate counts and fixed status values, with no customer text, storage paths, credentials, prompts or provider diagnostics.

Migration094's stage-specific database claim excludes work waiting for owner action before incrementing its attempt count or taking a lease. The adapter uses its actual generated database declaration, claims at most one job and limits each claim request to20seconds. It never falls back to the older general claim function. Current workers recheck the paid obligation, deadline, revision, version, evidence context and lease before their own mutations.

A lost claim, provider, upload or commit response is never treated as permission to repeat a side effect or delete a possibly committed object. Pair registration happens once in one database transaction after all upload cleanup intents exist. Reconciliation compares exact saved members and hashes; speculative deletion is forbidden. Existing cleanup handles proven orphans with its durable path protections. A newer draft keeps the artifact identity for its line/revision/type and creates new file versions, invalidating prior reviews.

The selected reference sheet is built locally from the exact currently permitted reference record versions. Reference names, contact details and private background notes are not sent to the writing provider. The sheet includes only the approved visible fields; private work-context/capability notes stay out. Permission replacement/revocation, missing reference members or an employer-required count shortage block completion. The same exact selected set is reviewed, registered and read back, with nine durable upload intents for three artifacts instead of six for two. Every owned plaintext/render buffer is cleared after use.

The maintenance runner allows300seconds across its version check, authenticated request and final response. Its request cancellation reaches the draft queue, database transport and isolated upload client. This bound provides room for the150-second stage and other maintenance; it does not establish actual hosted cycle duration. The queue returns aggregate counts only and performs no owner approval or Send action.

## Required acceptance before enablement

Verify current/guided/no-job intake through real application routes, initial listing review, packet creation, bounded synthetic writing, source promotion, wording review, complete rendering and registration, owner edits followed by re-render and fresh approval, separate Send, private customer downloads and retention. Exercise two workers, stale evidence/leases, switch changes, provider timeout, response loss at each mutation, partial upload, a second draft version, interrupted cleanup and required-reference holds. Preserve paid clocks and historical data throughout.

The maintenance integration must reserve enough bounded request time, report failed/unknown/held work accurately and prove its manual run plus two actual 15-minute cycles and independent failure/staleness alerts. Database fixtures, unit tests and image tests are distinct from this hosted proof. Approval of the consolidated quote and provider handling precedes real provider use; final go-live remains the owner's decision.
