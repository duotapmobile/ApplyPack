# Reviewed commute evidence

On-site and hybrid matches require a checked route from the customer's immutable confirmed starting ZIP to the employer's exact worksite. An employer's commute threshold is not evidence of that journey. Remote-only work has no commute gate.

Use **Admin → Matching workbench → Check the route to an on-site or hybrid job**. The form shows the confirmed ZIP and maximum one-way miles. Select the exact listing evidence, copy the street address or identifiable named worksite from it, and record the route source link, travel method, displayed one-way miles and minutes, time checked and review explanation. Confirm that the origin area and actual worksite were checked. The server determines whether the measured distance meets the confirmed limit. A city name alone does not establish a worksite; unresolved location evidence stays blocked.

No map provider request, account or spending is initiated by this form. The operator records a real route observation. ZIP-area observations do not establish a journey from a home address; the reviewer records that limitation and the actual route conditions. The customer's approved constraint is distance; minutes are retained as observed context, not a new customer time limit. Do not invent an estimate or assume an unconfirmed method is practical for the customer. Clarify material uncertainties before final submission, or hold the job for review.

The server binds `reviewed-commute-v1` evidence to the intake and job IDs and hashes, confirmed ZIP and limit, exact source node/locator/excerpt, authenticated reviewer and review time. The route must have been checked within 24 hours, no later than the review. Changing the intake or job requires a new review. Generic customer-criterion PASS records cannot resolve a commute. Missing, conflicting, stale, invalidated or superseded evidence cannot authorize the commute.

Migration `202610250090_matching_evidence_completion.sql` adds forward guards without rewriting historical records. The route is checked at evaluation, feasibility classification, selected ranking, new invitations, quotes, checkout creation, approved release review and delivery insertion. Renew the review and calculate a fresh evaluation after expiry. Existing paid obligations and payment completion are preserved; this migration does not block webhook settlement or refunds.

Private route fields remain inside `ap_human_review_records.decision`, covered by the existing customer-content redaction and restore filtering. The evaluation version bundle contains the policy version and review ID, not the route details. Do not put route notes, ZIPs or source URLs in analytics or operational logs.

## Remaining release-policy mismatch

`ap_record_job_release_review` still requires `root_result='PASS'` even when eligibility is `ELIGIBLE_WITH_ALLOWED_UNKNOWNS`. The corrected evaluation summary no longer reports fallback `BLOCK` policies from already-resolved roots, but it does not turn an actual unknown into PASS. This migration preserves that stricter approval rule. Allowed employer-unknown release acceptance needs a separately reviewed, precise rule and end-to-end tests; it is not silently authorized by this commute change.

A disconnected unpublished-salary-only predicate and fictional database/unit proof are prepared. Automatic approval review rejected both the broader original proposal and one narrower connection attempt; neither changed the release predicate. See `docs/audits/ALLOWED_UNKNOWN_RELEASE_REVIEW_2026-10-25.md` for the exact remaining approval and evidence.

## Verification scope

Local unit tests cover immutable bindings, observation bounds, stale/future times, resolved-distance derivation, generic-pass rejection, remote behavior, the owner form and feasibility refresh. `tests/integration/reviewed-commute.sql` exercises the forward schema and fictional persisted route evidence on an isolated native PostgreSQL cluster. These are local implementation checks. Production migration, hosted journey, operator route review, keyboard/screen-reader/device acceptance and launch remain separate gates.

Native PostgreSQL run `evidence/commute090-native-03` passed all 95 forward migrations and the reviewed-commute fixture, including malformed/wrong/stale route rejection, actual guarded review insertion, readiness closing when a required guard is disabled, and the disconnected salary policy. This is native PostgreSQL 18.6 engine proof, not hosted Supabase or the pinned PostgreSQL 17.11 recovery image proof.
