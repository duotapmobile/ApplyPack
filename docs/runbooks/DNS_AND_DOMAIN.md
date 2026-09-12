# DNS and domain

## Scope

Use this runbook for staging hostname checks, production DNS changes, and email-authentication records. The Railway staging hostname is an integration target. `applypack.work` is production-controlled and must not be changed under staging authorization.

## Prerequisites

- Exact approved release SHA and Railway environment/service IDs.
- Named DNS owner and rollback owner.
- Approved SPF, DKIM, DMARC, and sender-domain values from the configured email providers.
- Separate founder production authorization for any `applypack.work` mutation.

## Procedure

1. Verify the Railway project, `staging` environment, and `ApplyPack-staging` service before any change.
2. Keep staging non-indexed and payment-protected. Confirm `robots.txt`, `X-Robots-Tag`, canonical URLs, and no public production checkout.
3. For an authorized production change, record current DNS values and TTLs before editing. Change only approved records; never paste provider secrets into DNS or evidence.
4. Validate TLS, redirects, canonical host behavior, SPF alignment, DKIM signatures, and DMARC reporting after propagation.

## Verification

Record timestamp, resolver, expected and actual values, TLS result, HTTP redirect chain, search-indexing headers, and an allowlisted email header sample with addresses redacted.

## Failure and recovery

Restore the recorded prior DNS value when TLS, routing, or mail authentication regresses. Disable checkout and capacity while the public host is ambiguous.

## Stop conditions

Stop on account/project mismatch, unapproved production hostname work, unknown prior values, live-payment exposure, or any request to weaken mail authentication.
