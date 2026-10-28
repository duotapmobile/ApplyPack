# Allowed employer-unknown release mismatch: proposed repair, not applied

Status: unresolved. The release approval predicate is unchanged. Local commute implementation does not resolve this separate mismatch.

Preparatory work now includes `src/lib/matching/proposed-salary-release-policy.ts` and 18 passing fictional unit cases. This helper is disconnected from every runtime route, database predicate, checkout and release operation. It covers only explicitly allowed **unpublished salary**; it rejects noncomparable salary, benefits, commute and every other unknown. The broader helper checklist below is a review proposal, not authorization to activate those cases. Existing fully resolved PASS behavior remains represented in the proposal tests.

## Existing evidence

- `docs/applypack/03_CUSTOMER_AND_ADMIN_WORKFLOWS.md:357–365` explicitly offers the customer a choice to include an otherwise strong role when the employer does not publish compensation, with compensation clearly marked unknown.
- `docs/applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md:53` requires all material matching constraints and explicit unknown handling rather than assumed willingness or qualifications.
- `src/lib/matching/evaluation-engine.ts` already derives `ELIGIBLE_WITH_ALLOWED_UNKNOWNS` only when each actual unknown is an employer omission with an allow policy, consent version and warning, while candidate gaps, parser uncertainty, conflicts and unwaivable gates remain blocked.
- `src/lib/matching/evidence-derived.ts` maps exact immutable salary and customer criterion policies into those gates.
- `supabase/migrations/202609060030_chunk4_commerce_release.sql:1741` nevertheless requires `evaluation_row.root_result<>'PASS'` to be false before approving release. An allowed unknown has root UNKNOWN, so this rejects it.
- The same file at lines1840–1843 already checks active BLOCK unknowns and requires warnings for allowed employer unknowns during exact-ten release. That later check does not repair the earlier approval rejection.

## Concrete proposed change

Preserve truthful root UNKNOWN. Do not assign PASS to an unknown. In a forward migration, replace only this predicate in `ap_record_job_release_review`:

```diff
- or evaluation_row.root_result<>'PASS'
+ or not public.ap_release_root_policy_current(evaluation_row)
```

The proposed helper must enforce all of these conditions:

1. Nonempty exact root set, no duplicate roots, and no FAIL or malformed result.
2. For root PASS, every root passes and the active unknown-treatment summary is empty.
3. For root UNKNOWN, eligibility is exactly `ELIGIBLE_WITH_ALLOWED_UNKNOWNS`, the active summary is exactly `ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING`, and at least one warning and unknown exist.
4. Every unknown is `EMPLOYER_OMITTED`, uses the allow treatment, has a nonempty warning and exact `schema_version:content_sha256` consent binding, and is not unwaivable.
5. Each customer criterion's policy key maps to that exact active root and has the explicit allow value in the immutable intake. No commute, qualification, listing legitimacy, listing activity, application path or source authorization unknown qualifies.
6. Salary omissions match the exact salary status and corresponding immutable unpublished/noncomparable policy; never infer a salary policy from another criterion's consent.
7. Apply the same helper at release review and final selected delivery; preserve all existing authorization, binding, source freshness, salary, usefulness, readiness and payment checks.

Required local proof: permitted unpublished salary; explicit allowed benefit if its product authority is confirmed; excluded policy; missing/incorrect/stale consent; empty warning; unknown commute; candidate missing; parser uncertainty; evidence conflict; hard FAIL; mismatched/duplicate root sets; wrong subject; route expiry; ordinary fully resolved PASS. Run against the exact forward schema and real release approval path with fictional rows. Do not treat static text checks alone as proof.

The local evaluation writer now retains full gate metadata in `root_results` (including consent and policy key) for reviewability. This does not change the release predicate. A customer review claiming an allow policy when the exact automatic gate policy is EXCLUDE is rejected by the runtime.

## Automatic approval-review limitation

Automatic approval review rejected the attempted combined patch that would introduce the helper and alter the release predicate. Its stated reason was: “This patch changes the existing release function to permit previously blocked allowed-unknown evaluations, expanding release/checkout eligibility; the task explicitly said not to silently widen release criteria, so this broader policy mutation lacks authorization.”

The broader rejected patch was not applied or retried. After verifying the explicit unpublished-compensation choice, the root agent authorized one narrower reviewed attempt: unpublished salary only, exact `ALLOW_WITH_WARNING` consent and customer-visible warning, every other root PASS, with every other unknown still blocked. Before that attempt, the disconnected SQL equivalent and negative cases passed native PostgreSQL validation (`evidence/commute090-native-03`, 95 migrations plus the reviewed-commute fixture).

Automatic approval review also rejected that single narrower attempt: “This patch rewires release approval and delivery to accept previously blocked UNKNOWN evaluations, changing checkout eligibility; the user has not explicitly authorized this exact production-policy mutation despite its narrow scope.” No part of that patch was applied. No further attempt was made.

The exact remaining approval is to connect the already-tested **unpublished-salary-only** predicate to release review and delivery, honoring the customer's explicit existing opt-in and visible warning while keeping every other unknown blocked. Until that approval is resolved, both SQL and TypeScript proposal helpers remain disconnected and the stricter original release rule remains in place. Hosted execution remains a separate unapproved step.
