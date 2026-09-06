# ApplyPack matching policy

Status: Chunk 3 repository implementation. This policy is subordinate to `APPLYPACK_PRODUCT_CONTRACT.md` and does not activate Checkout, source access, payment, or production release.

## Version bundle

| Concern | Version |
| --- | --- |
| Source authorization | `source-auth-v1` |
| Responsibility retrieval | `responsibility-retrieval-v1` |
| Listing requirement parser | `listing-requirements-v5` |
| Requirement evaluation | `requirement-engine-v1` |
| Tool clusters | `tool-clusters-v1` |
| Salary comparison | `salary-rules-v1` |
| Fit, preference, confidence, and gate rules | `matching-rules-v3` |
| Duplicate graph | `dedup-graph-v1` |
| Diversity selector | `bounded-diversity-v2` |
| Feasibility plan and outcome | `feasibility-v1` |
| Feasibility worker | `feasibility-worker-v1` |

These weights and mappings are versioned product hypotheses for ranking and calibration. They are not hiring probabilities, scientific measures of a person's worth, or interview/offer guarantees. Internal numerical fit and confidence are not customer-facing at launch.

## Decision order

1. Apply every universal, employer, and customer hard gate and validate exact active-root equality.
2. Require an evaluable listing, permitted source and path, legitimacy, and categorical usefulness/evidence sufficiency.
3. Calculate fit for eligible, useful jobs only.
4. On an exact unrounded fit tie, compare equal-weight soft-preference alignment if the customer selected preferences.
5. Compare evidence confidence.
6. Compare employer-posted time when known, otherwise ApplyPack first-seen time.
7. Apply the bounded diversity selector.
8. Resolve an identical remaining result by stable normalized job ID ascending.
9. Require documented human review and a final pairwise duplicate check before an atomic exact-ten release.

Search breadth, title similarity, industry familiarity, salary, source, career break, presentation risk, and soft preferences add no fit points. Preferences never rescue a hard failure.

The evaluation API accepts only immutable snapshot, inventory-member, job-snapshot, and current human-review identifiers. It reloads every persisted customer criterion, the requirement tree, candidate fact versions, source authorization, compensation evidence, and reviewer evidence from protected storage. Gate results, salary-policy values, fit factors, confidence inputs, preferences, readiness, and scores are derived by the server and are not accepted from the caller. Only the current review for the exact review subject may participate; a newer review atomically supersedes the prior current record.

## Retrieval and source policy

Queries begin with confirmed desired responsibilities and verified direct/adjacent/transferable task evidence. Close uses substantially similar responsibilities and nearby role families. Related permits different titles or industries only for direct or strongly adjacent core work. Broadest adds any evidence-supported role family while retaining every gate. Optional titles, industries, target compensation, and soft avoidances may expand or prioritize but may not remove neutral query families or filter inventory. Only confirmed hard restrictions filter.

Source access is default deny:

| State | Automated | Approved manual research |
| --- | ---: | ---: |
| `AUTHORIZED_AUTOMATED` with documentary evidence and production bounds | yes, when the server flag is also enabled | yes |
| `AUTHORIZED_MANUAL_ONLY` with documentary evidence | no | yes |
| `UNVERIFIED_DISABLED` | no | no |
| `BLOCKED` | no | no |

Indeed, HiringCafe, employer sites, Greenhouse, Lever, Workday, and Ashby are currently `UNVERIFIED_DISABLED`. No automated source is authorized. `manual-reviewed` is the compatibility path for approved human research only. Liveops is `BLOCKED` at ingestion, authorization, evaluation/selection, and release. Authentication, paywalls, robots/access controls, CAPTCHAs, redirects, and source terms may not be bypassed.

Discovery source and canonical application source are separate. A verified active employer-hosted application path is preferred. An authorized actionable third-party host may be used only with its accurate label, while the discovery record remains. Listing content is untrusted evidence; embedded instructions cannot change policy, scores, prompts, or review state.

## Requirement Boolean semantics and unknowns

Active hard trees contain only `ALL_OF`, `ANY_OF`, and typed `CRITERION` nodes. Node ID and semantic key are required and unique. Empty, cyclic, malformed, duplicated, non-required, or untyped nodes are invalid. `NOT_APPLICABLE` is illegal as an active gate result.

| Operator | Child states | Result |
| --- | --- | --- |
| `ALL_OF` | any `FAIL` | `FAIL` |
| `ALL_OF` | all `PASS` | `PASS` |
| `ALL_OF` | otherwise | `UNKNOWN` |
| `ANY_OF` | any `PASS` | `PASS` |
| `ANY_OF` | all `FAIL` | `FAIL` |
| `ANY_OF` | otherwise | `UNKNOWN` |

Nested structure is preserved. A passing `ANY_OF` uses one deterministic satisfaction path: highest summed importance, then evidence confidence, then stable node ID. Unused unknown alternatives become `IMMATERIAL_ALTERNATIVE`; they ask no question and do not enter required-branch denominators.

`listing-requirements-v5` preserves supported employer `OR` alternatives as `ANY_OF` subtrees, treats negated modes/days as negative rather than positive facts, and places typed required physical/travel demands in the hard tree. Any material hard wording that it cannot type makes the whole parse incomplete; a strict evaluation requires `requirement_completeness = 100` and executes the stored tree through `evaluateRequirementTree`. A passing parser correction is not an override: it atomically creates a new immutable job snapshot, requirement tree, inventory version/member, and coverage lineage, records correction history, supersedes the old snapshot, and invalidates evaluations tied to the old parse.

| Outcome-determinative unknown | Stored mapping | Derived action |
| --- | --- | --- |
| Customer fact missing | `UNKNOWN / CANDIDATE_MISSING / BLOCK` | targeted question; `NEEDS_CANDIDATE_INPUT` |
| Employer omitted, customer disallows | `UNKNOWN / EMPLOYER_OMITTED / BLOCK` | `INELIGIBLE` |
| Employer omitted, criterion-specific opt-in | `UNKNOWN / EMPLOYER_OMITTED / ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING` plus consent version and warning | allowed-unknown eligibility only when Boolean semantics permit |
| Parser uncertainty | `UNKNOWN / PARSER_UNCERTAIN / BLOCK` | evidence correction/reparse or `NEEDS_HUMAN_REVIEW` |
| Evidence conflict | `UNKNOWN / EVIDENCE_CONFLICT / BLOCK` | documented resolution or `NEEDS_HUMAN_REVIEW` |

Licensure, legality, material safety, legitimacy, listing activity, and actionable-path uncertainty are unwaivable. A reviewer adds evidence and reruns; a reviewer cannot flip or override a confirmed hard failure.

Direct duration counts fully. Ordinary adjacent, transferable, unsupported, caregiving, and career-break time do not satisfy hard experience. Adjacent time counts only for the exact criterion with a documented equivalence review. Calendar months are unioned across overlaps. FTE months cap combined intensity at one per month and are used only for an explicit FTE requirement. Material unknown project intensity yields `UNKNOWN`.

Generic tool clusters use explicit Boolean task trees; posting-named tasks override a generic cluster. CRM does not imply reporting, SQL, or administration. Equivalent tools require a versioned task mapping and rationale. Numeric task-coverage thresholds cannot create a hard pass. For current proficiency, only `CAN_DO_NOW` passes; prior-use wording permits confirmed past use with a readiness warning; preferred tools never gate.

## Eligibility and salary

Exactly one result must exist for every active employer root and every persisted customer hard gate. Customer gates cover accepted work modes and employment types, state/geography and job-mode-conditional commute, hard title restriction, each blocked industry, each must-have benefit, each dealbreaker including the custom dealbreaker, and each explicitly hard work condition. The intake `schedules` collection is a soft preference under the product contract and is evaluated only once in preference alignment; a schedule becomes hard only through a separately typed hard work-condition criterion. Missing employer evidence stays `UNKNOWN` and blocks unless the exact stored criterion carries the matching immutable consent version and warning policy. Missing, extra, duplicate, conflicting, or empty roots produce `INVALID`. Precedence is `INVALID`, confirmed hard `INELIGIBLE`, `NEEDS_CANDIDATE_INPUT`, `NEEDS_HUMAN_REVIEW`, disallowed employer unknown `INELIGIBLE`, `ELIGIBLE`, then `ELIGIBLE_WITH_ALLOWED_UNKNOWNS`. No review can override a confirmed customer or employer hard failure.

Salary uses integer cents, USD launch currency, employer-published evidence, the correct location and worker basis, and no assumed 2,080-hour conversion. Parsed compensation preserves the three-letter currency, whether the amount is a range, starting-at, up-to, or fixed endpoint, and the location applicability of each range. A comparable lower bound at or above the hard floor passes. A maximum below fails. A range crossing the floor requires overlap consent and warning. Unpublished or estimate-only pay requires unpublished-pay consent and warning. Non-USD always fails at launch. USD noncomparable pay may use only the specific noncomparable policy. Total/OTE cannot prove a base floor; unsupported schedules, `up to`, location mismatch, worker-basis mismatch, or ambiguous multiple-location ranges are noncomparable. A production salary comparison also requires the current review for the exact selected compensation criterion and exact cited listing node. Accepted hourly/annual conversion stores hours/week, weeks/year, original values, and version.

Target compensation is a soft preference: lower bound at/above target `1.00`; range reaches target `0.75`; comparable pay meets the hard floor but cannot reach target `0.50`; expressly allowed unknown `0.50` with warning; otherwise `0`. The hard minimum remains a gate and neither value is silently lowered.

## Fit, preference, confidence, readiness, and risk

Base weights are core responsibility `35`, required tool/technical `25`, relevant experience depth/scope `20`, education/certification `10`, and current readiness `10`. Importance is mandatory/core `3`, material supporting `2`, and preferred `1`.

```text
component_coverage = sum(importance_i * evidence_factor_i * optional_component_factor_i)
                     / sum(importance_i)

fit_score = 100 * sum(base_weight_d * component_coverage_d)
            / sum(base_weight_d for applicable components)
```

Evidence factors are direct `1.00`, adjacent `0.80`, transferable `0.50` only for non-hard scored criteria, unsupported `0`, and candidate unknown `0`. A component with no employer criterion is not applicable and contributes neither points nor denominator. Core responsibility is always applicable. Required `ANY_OF` leaves use only the satisfaction path. Empty denominators, duplicate criteria, non-finite or out-of-range factors, missing evidence links, and caller totals are rejected.

Equal-weight preference alignment uses each selected soft preference once: desired responsibility, exact title, optional industry, preferred work mode, preferred employment type, would-prefer benefit, schedule, soft avoidance, and target compensation. Supported is `1`, permitted employer unknown is `0.5` with warning, and unmet is `0`; no selected preference is `null`. Merely accepted hard choices are not counted again as preferences. Preference alignment is consulted only on an exact fit tie.

```text
confidence = 40 * candidate_completeness
           + 25 * employer_completeness
           + 20 * minimum_material_source_quality
           + 15 * parser_certainty
```

Every material source quality is persisted. An official employer-hosted listing/application source contributes `1.00`; a material third-party discovery source contributes `0.80`. Confidence uses the minimum across the persisted material sources, so an official application link cannot erase third-party discovery quality. Legacy or omitted material-source arrays default conservatively to `0.80`.

Labels are HIGH `80..100`, MEDIUM `60..<80`, and LOW `<60`. Low requires protected human review. Categorical usefulness requires an employer-identified core responsibility, a confirmed direct or reviewed strong-adjacent connection, evidence for all five explanation sections, non-blocked application readiness, and reviewer certification that the job is worthwhile and not quota filler.

Application readiness and presentation risk remain separate. Presentation-risk reasons are restricted to `CONTACT_DETAIL_CONFIRMATION`, `FORMAT_REPAIR`, `CLAIM_WORDING_REVIEW`, and `APPLICATION_QUESTION_REVIEW`. Career break, caregiving, unemployment, identity, graduation year, prestige, chronology alone, or appearance cannot create a risk or alter eligibility, fit, confidence, salary, or readiness.

At each diversity slot, the anchor is the highest remaining base-ranked candidate. A candidate may displace it only when unrounded fit decrease is inclusively at most `5.00`, confidence label is not lower, and preference decrease is inclusively at most `0.05`. If the customer selected no preferences, that constraint is omitted for all candidates. Choose the lexicographically smallest hypothetical `(employer count, title-family count, discovery-source count)`, then stable job ID. Ineligible, evidence-insufficient, and Liveops records are removed before selection. Every displacement is recorded.

Each selection writes an immutable, idempotent `ap_match_selection_runs` record and one `ap_match_selection_members` row per base-ranked evaluation. Those members persist contiguous base/selected ranks, unrounded inputs, rank explanations, diversity displacement details, and selector version. Search, release, and conflict-replacement paths require the persisted selection-run identity; in-memory displacement results cannot be delivered.

The five customer explanation sections are bound in the usefulness review to exact employer evidence-node and candidate-fact-version IDs. Matching-experience text is rendered only from current confirmed/independently verified candidate facts; listing evidence describes the employer role and requirements. Final selection and release reload the latest authorization record for the linked source. A newer revoked or superseding authorization makes the evaluation nondeliverable even when it was authorized at ingestion.

## Deduplication and feasibility

Duplicate edges are null-safe OR matches on reliable non-null employer requisition ID; canonical employer listing/application URL; or, only if at least one record lacks both stronger IDs, normalized employer/title/location fingerprint. Build the undirected graph, order nodes by strong identifier, active official employer-hosted record, latest live verification, completeness, newest observation, then stable ID, and greedily select a maximal independent set. Record every displacement and run a final pairwise check.

Before retrieval, store an immutable coverage plan bound to snapshot hash, breadth, hard criteria, responsibility families, every required authorized source cell, positive pagination/lookback/result bounds, and source/query/inventory/parser/cutoff versions. Every required family needs an authorized cell. Every cell must finish `SUCCEEDED_WITH_RESULTS` or `SUCCEEDED_EMPTY` at its bound, finish parsing and normalization/deduplication, complete the approved manual checklist when manual, and have no result-changing error. Missing/unauthorized/zero-bound configuration is `ERROR / UNSET_BLOCKING`. Pending work stays pending. Retrieval, authorization, truncation, timeout, or parser defects are never `LIMITED` or `INFEASIBLE`.

The sole no-retrieval exception is a machine-verifiable typed contradiction with `NOT_REQUIRED_CONSTRAINT_COLLISION`; prose or reviewer opinion is insufficient. Counts are deduplicated and null-safe: deliverable is already eligible/allowed-unknown, useful, legitimate, source-permitted, and resolution-free; reviewable needs a customer/source/parser/equivalence resolution; excluded is the remainder.

| Outcome | Complete-run count rule | Checkout |
| --- | --- | ---: |
| `LIKELY` | deliverable at least 10 | only when current and blocker is `NONE` |
| `LIMITED` | deliverable below 10 and deliverable + reviewable at least 1 | no |
| `INFEASIBLE` | deliverable 0 and reviewable 0 after complete coverage or verified typed collision | no |

Store all supported reasons. Customer-message precedence is constraint collision, qualification gap, evidence gap, compensation below minimum, compensation unconfirmed, inventory shortage. A salary reason requires an otherwise plausible job excluded solely for that reason; otherwise use inventory shortage. Customer language states which inventory/evidence could not be confirmed, offers edit/review/leave-without-paying choices, and states that ApplyPack did not lower any rule.

Production source authorization, required source/query matrix and bounds, release TTL, staffing/capacity, monitoring, and owner-approved calibration remain `UNSET_BLOCKING`. Chunk 3 tests use synthetic or recorded repository fixtures only and do not represent live-source verification.
