# Material draft processing

Status: source integration in progress; not hosted or activated. Keep all three switches below false until the final committed revision, stage-specific database claiming, complete pair registration, owner controls and approved provider configuration pass connected acceptance. This runbook does not authorize spending, data transfer, migrations or deployment.

## Separate stages and authority

| Stage | Required input | Result | Human boundary |
| --- | --- | --- | --- |
| Prepare | Active paid obligation, exact confirmed intake/revision, permitted fresh job/instructions and current before-generation listing check | Encrypted immutable evidence packet | Missing or changed evidence requires clarification or an explicit fresh owner check; the scheduler does not manufacture observations. |
| Generate | Current packet, enabled immutable provider policy, reserved bounded spend and approved data handling | Encrypted unapproved writing proposal | No automatic promotion, wording approval or customer delivery. An uncertain provider result retains its reservation for reconciliation. |
| Render | Promoted exact source, complete explicit wording review, current evidence, approved isolated renderer/fonts and delivery-format decision | Complete registered resume/cover-letter pair for visual review | Review, approval and Send remain separate. Reference-required work holds until the required third artifact is supported. |

Employer application questions are untrusted source evidence and tailoring clues. Keep their exact wording, source, observation time and completeness visible to the owner. Use only confirmed customer facts when responding to the employer's priorities; see [the question protocol](EMPLOYER_APPLICATION_QUESTIONS.md).

## Configuration

- `APP_MATERIAL_DRAFT_QUEUE_ENABLED=false`: overall background scheduling gate; its maintenance adapter remains in integration.
- `APP_MATERIAL_DRAFTING_ENABLED=false`: separate provider dispatch gate. The database runtime and immutable policy must also authorize the exact provider/model, privacy/evaluation/quote references and token/spend limits. A key's presence is not permission.
- `APP_MATERIAL_DRAFT_RENDERING_ENABLED=false`: separate rendering gate; it does not enable writing or sending. Renderer readiness, private encryption and current exact document evidence remain required.
- `OPENAI_API_KEY`: server-only provider credential entered through approved service storage. Never put it in browser configuration, source control, evidence bundles or chat.

Source-aware local rendering additionally requires the pinned `pdftohtml` executable and its hash. Linux worker image checks validate the corresponding isolated implementation. Existing approved fonts, paragraph/link checks, page previews and cleanup remain mandatory. A local fixture render does not establish hosted readiness or owner visual acceptance.

## Bounded queue contract under integration

The orchestrator processes at most one claimed stage per invocation, preferring a ready render, then generation, then packet preparation. Its overall deadline is 150 seconds and it checks switches again after claiming. It returns only aggregate counts and fixed status values, with no customer text, storage paths, credentials, prompts or provider diagnostics.

The stage-specific database claim must exclude work waiting for owner action before incrementing its attempt count or taking a lease. The older general claim function alone does not meet that requirement. No cron wiring may use it as a fallback. Current workers recheck the paid obligation, deadline, revision, version, evidence context and lease before their own mutations.

A lost claim, provider, upload or commit response is never treated as permission to repeat a side effect or delete a possibly committed object. Pair registration happens once in one database transaction after all upload cleanup intents exist. Reconciliation compares exact saved members and hashes; speculative deletion is forbidden. Existing cleanup handles proven orphans with its durable path protections. A newer draft keeps the artifact identity for its line/revision/type and creates new file versions, invalidating prior reviews.

## Required acceptance before enablement

Verify current/guided/no-job intake through real application routes, initial listing review, packet creation, bounded synthetic writing, source promotion, wording review, complete rendering and registration, owner edits followed by re-render and fresh approval, separate Send, private customer downloads and retention. Exercise two workers, stale evidence/leases, switch changes, provider timeout, response loss at each mutation, partial upload, a second draft version, interrupted cleanup and required-reference holds. Preserve paid clocks and historical data throughout.

The maintenance integration must reserve enough bounded request time, report failed/unknown/held work accurately and prove its manual run plus two actual 15-minute cycles and independent failure/staleness alerts. Database fixtures, unit tests and image tests are distinct from this hosted proof. Approval of the consolidated quote and provider handling precedes real provider use; final go-live remains the owner's decision.
