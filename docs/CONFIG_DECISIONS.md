# ApplyPack configuration decisions

Version 2026-09-04. Secret values are never recorded here. Allowed statuses are `LOCKED_BY_CONTRACT`, `EXISTING_VERIFIED`, `APPROVED_CONFIGURED`, `UNSET_BLOCKING`, `EXTERNAL_PENDING`, `SUPERSEDED`. Fail modes are `BOOT_BLOCKING`, `FEATURE_BLOCKING`, or `RELEASE_BLOCKING`.

## Product, security, and operations

| ID | Setting | Environment | Type/unit and allowed range | Status/value | Non-secret source/owner | Consumers/validation | Fail mode/tests/external setup | Last verified/version |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CFG-001 | Search price | all | integer cents; exactly 2000 | LOCKED_BY_CONTRACT | Part I / product owner | checkout, copy / unit+e2e | FEATURE_BLOCKING / Stripe price mapping | 2026-09-04/v1 |
| CFG-002 | Search result count | all | integer; exactly 10 | LOCKED_BY_CONTRACT | Part I / product owner | matching, release, refunds / unit+integration | FEATURE_BLOCKING / exact-ten suite | 2026-09-04/v1 |
| CFG-003 | Materials unit price | all | integer cents; exactly 800 per job | LOCKED_BY_CONTRACT | Part I / product owner | checkout, entitlement / unit+e2e | FEATURE_BLOCKING / Stripe mapping | 2026-09-04/v1 |
| CFG-004 | Currency | all | ISO code; USD only | LOCKED_BY_CONTRACT | Part I / product owner | all money / unit+DB | BOOT_BLOCKING | 2026-09-04/v1 |
| CFG-005 | Search delivery target | all | duration; 24 hours from latest prerequisite | LOCKED_BY_CONTRACT | Part I / operations | deadlines / fake-clock suite | FEATURE_BLOCKING / scheduler | 2026-09-04/v1 |
| CFG-006 | Materials delivery target | all | duration; 24 hours per eligible line | LOCKED_BY_CONTRACT | Part I / operations | deadlines / fake-clock suite | FEATURE_BLOCKING / scheduler | 2026-09-04/v1 |
| CFG-007 | Checkout capacity reservation | all | duration; exactly 30 minutes | LOCKED_BY_CONTRACT | Part I / operations | capacity/checkout / concurrency | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-008 | Upload count | all | one required resume plus one optional cover letter | LOCKED_BY_CONTRACT | Part I / security | intake/storage / upload suite | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-009 | Upload size | all | bytes; max 10 MiB each | LOCKED_BY_CONTRACT | Part I / security | intake/storage / boundary tests | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-010 | Upload formats | all | PDF or DOCX, readable, text-based, unencrypted, macro-free | LOCKED_BY_CONTRACT | Part I / security | scanner/parser / malicious fixtures | FEATURE_BLOCKING / scanner+parser | 2026-09-04/v1 |
| CFG-011 | Signed download TTL | all | duration; exactly 15 minutes after fresh reauth | LOCKED_BY_CONTRACT | Part I / security | portal/storage / access tests | FEATURE_BLOCKING / signer | 2026-09-04/v1 |
| CFG-012 | Customer-supplied jobs | all | Boolean; false by default | LOCKED_BY_CONTRACT | Part I / product owner | ingestion/admin / flag test | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-013 | Liveops | all | source authorization; blocked | LOCKED_BY_CONTRACT: BLOCKED | Part I / source owner | source registry / deny tests | BOOT_BLOCKING for adapter | 2026-09-04/v1 |
| CFG-014 | App URL | production | HTTPS origin/allowlist | EXISTING_VERIFIED: `https://applypack.work` in example | repository / platform owner | links/callbacks / config validation | RELEASE_BLOCKING / DNS+callback proof | 2026-09-04/v1 |
| CFG-015 | Display timezone | all | IANA zone | EXISTING_VERIFIED: `America/New_York` example | repository / operations | deadlines/admin / DST tests due | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-016 | Supabase public config | production | URL+publishable key | EXTERNAL_PENDING | platform owner | client/auth / boot validation | BOOT_BLOCKING / provision project | 2026-09-04/v1 |
| CFG-017 | Supabase secret config | production | secret reference only | EXTERNAL_PENDING | platform owner | server/admin / boot validation | BOOT_BLOCKING / secret store | 2026-09-04/v1 |
| CFG-018 | Stripe credentials/webhook | production | secret references only | EXTERNAL_PENDING | payments owner | checkout/webhook / signed fixtures+live verify | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-019 | Stripe price IDs | production | approved price IDs matching locked cents | EXTERNAL_PENDING | payments owner | checkout / startup+provider validation | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-020 | Tax/additional fees | production | no added tax/fee unless separately approved | UNSET_BLOCKING | owner/legal/payments | totals/copy / integer math | RELEASE_BLOCKING / written approval | 2026-09-04/v1 |
| CFG-021 | Email provider/domain | production | verified Resend sender/reply-to | EXTERNAL_PENDING | communications owner | access/delivery / capture+provider verify | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-022 | Encryption/KMS | production | approved keys/rotation; secret refs | UNSET_BLOCKING | security owner | sensitive payloads/references / crypto tests | RELEASE_BLOCKING / KMS | 2026-09-04/v1 |
| CFG-023 | Malware scanner | production | fail-closed adapter/timeouts | EXTERNAL_PENDING | security owner | uploads / malicious fixtures | FEATURE_BLOCKING / scanner | 2026-09-04/v1 |
| CFG-024 | Parser/OCR | production | sandboxed local parse; OCR only if approved | UNSET_BLOCKING | security/privacy owner | documents / hostile fixtures | FEATURE_BLOCKING / approved service | 2026-09-04/v1 |
| CFG-025 | Model boundary | all | no reference PII; permitted models only | LOCKED_BY_CONTRACT | Part I / privacy owner | extraction/generation / leak tests | FEATURE_BLOCKING | 2026-09-04/v1 |
| CFG-026 | Scheduler/lease | production | one durable owner per job | EXTERNAL_PENDING | operations owner | cleanup/deadlines/reconcile / lease tests | RELEASE_BLOCKING / worker topology | 2026-09-04/v1 |
| CFG-027 | Staff roles | production | least privilege, purpose-based, audited | UNSET_BLOCKING | security/operations owner | admin/review/reference access / authz suite | RELEASE_BLOCKING / assignments | 2026-09-04/v1 |
| CFG-028 | Arial render environment | production/release | Arial-capable DOCX renderer | EXTERNAL_PENDING | document owner | generated artifacts / rendered inspection | RELEASE_BLOCKING / licensed font+renderer | 2026-09-04/v1 |
| CFG-029 | Monitoring/alerts | production | DSN, alerts, owners, thresholds | EXTERNAL_PENDING | operations owner | errors/jobs/payments / alert exercise | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-030 | Analytics/consent | production | privacy-approved events only, no sensitive text | UNSET_BLOCKING | privacy/product owner | funnels/experiments / schema scan | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-031 | Unpaid draft retention | production | positive approved duration | UNSET_BLOCKING | owner/legal/privacy | cleanup/privacy / fake-clock+deletion | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-032 | Source document retention | production | approved duration | UNSET_BLOCKING | owner/legal/privacy | storage cleanup / deletion tests | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-033 | Generated artifact retention | production | approved duration/state matrix | UNSET_BLOCKING | owner/legal/privacy | storage/portal / deletion tests | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-034 | Financial/audit retention | production | approved legal duration/holds | UNSET_BLOCKING | owner/legal/finance | payments/audit / deletion exceptions | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-035 | Reference PII retention | production | purpose/permission/revocation-based | UNSET_BLOCKING | owner/legal/privacy | reference domain / revocation tests | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-036 | Search capacity | production | nonnegative units per pool/bucket | UNSET_BLOCKING | operations owner | feasibility/checkout / concurrency | RELEASE_BLOCKING / staffing version | 2026-09-04/v1 |
| CFG-037 | Materials capacity | production | nonnegative atomic units per line | UNSET_BLOCKING | operations owner | checkout/substitution / concurrency | RELEASE_BLOCKING / staffing version | 2026-09-04/v1 |
| CFG-038 | Job freshness | production | approved duration per source/type | UNSET_BLOCKING | source owner | eligibility/search / fake clock | FEATURE_BLOCKING / source evidence | 2026-09-04/v1 |
| CFG-039 | Rate limits | production | positive per-route limits | UNSET_BLOCKING | security/operations owner | draft/auth/checkout/admin / abuse tests | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-040 | Callback/redirect allowlists | production | exact HTTPS origins/routes | UNSET_BLOCKING | security/payments owner | auth/Stripe/email / redirect tests | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-041 | Legal document versions | production | immutable approved version IDs | UNSET_BLOCKING | owner/legal | intake/order/audit / consent tests | RELEASE_BLOCKING | 2026-09-04/v1 |
| CFG-042 | Existing 150-minute reservation | current legacy | integer minutes | SUPERSEDED | corrected Part I / engineering | legacy config/migrations / compatibility tests | FEATURE_BLOCKING until migrated | 2026-09-04/v1 |
| CFG-043 | Existing 7/30-day retention | current legacy | integer days | SUPERSEDED | corrected Part I / privacy | cleanup/storage / compatibility tests | RELEASE_BLOCKING until approval | 2026-09-04/v1 |
| CFG-044 | Existing 24/72-hour freshness | current legacy | integer hours | SUPERSEDED | corrected Part I / source owner | source health / compatibility tests | FEATURE_BLOCKING until approval | 2026-09-04/v1 |

## Source authorization registry

No row is a legal conclusion. `UNVERIFIED_DISABLED` means no automation may run until a documentary approval is added with owner, permitted method, terms/robots/API basis, rate/identity limits, and verification date. Manual compatibility identities do not authorize scraping.

| ID | Source or class | Environment/type/range | Status/value | Non-secret source/owner | Consumers/validation | Fail mode/tests/external setup | Last verified/version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SRC-001 | `manual-reviewed` | all/manual import | EXISTING_VERIFIED: manual-only | repository source docs / search owner | admin import / provenance tests | FEATURE_BLOCKING if treated automated | 2026-09-04/v1 |
| SRC-002 | Indeed | all/third-party identity | UNSET_BLOCKING: UNVERIFIED_DISABLED | private research + repository / source owner | imports/dedupe / deny-by-default test | RELEASE_BLOCKING for automation / approval | 2026-09-04/v1 |
| SRC-003 | HiringCafe | all/third-party identity | UNSET_BLOCKING: UNVERIFIED_DISABLED | private research + repository / source owner | imports/dedupe / deny-by-default test | RELEASE_BLOCKING for automation / approval | 2026-09-04/v1 |
| SRC-004 | Lever public postings | all/provider API | UNSET_BLOCKING: UNVERIFIED_DISABLED | existing registry is evidence only / source owner | adapters / endpoint+rate tests | RELEASE_BLOCKING for automation / documentary approval | 2026-09-04/v1 |
| SRC-005 | Greenhouse | all/provider/API or link | UNSET_BLOCKING: UNVERIFIED_DISABLED | source owner | registry / deny-by-default test | RELEASE_BLOCKING for automation / approval | 2026-09-04/v1 |
| SRC-006 | Workday | all/provider/site | UNSET_BLOCKING: UNVERIFIED_DISABLED | source owner | registry / deny-by-default test | RELEASE_BLOCKING for automation / approval | 2026-09-04/v1 |
| SRC-007 | Ashby | all/provider/API or link | UNSET_BLOCKING: UNVERIFIED_DISABLED | source owner | registry / deny-by-default test | RELEASE_BLOCKING for automation / approval | 2026-09-04/v1 |
| SRC-008 | Direct-employer sites | all/site-specific | UNSET_BLOCKING: UNVERIFIED_DISABLED | repository/private research / source owner | registry / per-source tests | RELEASE_BLOCKING for automation / per-source approval | 2026-09-04/v1 |
| SRC-009 | Affiliate/directories | all/site-specific | UNSET_BLOCKING: UNVERIFIED_DISABLED | private research / source owner | registry / per-source tests | RELEASE_BLOCKING for automation / per-source approval | 2026-09-04/v1 |
| SRC-010 | Customer supplied | all/customer input | LOCKED_BY_CONTRACT: disabled by default | Part I / product owner | admin ingestion / feature-flag test | FEATURE_BLOCKING / explicit later authorization | 2026-09-04/v1 |
| SRC-011 | Liveops and aliases/URLs | all/any | LOCKED_BY_CONTRACT: BLOCKED | Part I / source owner | normalization, DB, filtering / three-layer deny tests | BOOT_BLOCKING for adapter | 2026-09-04/v1 |

## Chunk 4 external activation matrix

Repository implementation does not prove a provider/dashboard setting. Every row below must be recorded against the production environment by its owner and retested before Checkout or workers are enabled. Secret values belong only in the approved secret store.

| ID | Non-secret production value or decision | Repository state | External owner/proof and retest | Fail mode |
| --- | --- | --- | --- | --- |
| CFG-C4-001 | Canonical site URL: `https://applypack.work` | Exact example and runtime validation implemented | Platform owner verifies deployed origin, TLS, DNS, and `/api/health`; then exercises an absolute production link | RELEASE_BLOCKING |
| CFG-C4-002 | Passwordless callback: `https://applypack.work/auth/callback` | Exact database and checkout validation implemented | Auth owner adds this exact HTTPS callback and no wildcard; test cross-device, expired, replayed, and safe relative return paths | RELEASE_BLOCKING |
| CFG-C4-003 | Redirect allowlist: `https://applypack.work/auth/callback` only for the Chunk 4 access flow | No production dashboard change made | Auth owner exports/redacts allowlist evidence and proves an unlisted origin and open redirect are rejected | RELEASE_BLOCKING |
| CFG-C4-004 | Search price: one-time immediate charge, `USD 20.00`, quantity 1; no added tax or fee | Server fixes 2,000 cents/USD and rejects browser price or unsupported settlement modes | Payments/legal owner approves tax-inclusive treatment, creates/verifies the Stripe price, records its non-secret ID mapping and API version, and reruns test-mode checkout/webhook/refund reconciliation | FEATURE_BLOCKING; tax approval remains `UNSET_BLOCKING` |
| CFG-C4-005 | Accepted payment methods: `card` with immediate paid settlement only | Authorization/capture, delayed-confirmation, and unsettled methods fail closed | Payments owner verifies Checkout dashboard/payment-method configuration and a signed immediate-charge webhook before setting any enablement flag | FEATURE_BLOCKING |
| CFG-C4-006 | Stripe webhook: production endpoint for `/api/stripe/webhook`, raw signed body, current approved API version | Signature and monotonic replay handling implemented; no endpoint registered | Payments owner registers the endpoint, stores signing secret, verifies event delivery/replay, and exercises ambiguous create/refund reconciliation | FEATURE_BLOCKING |
| CFG-C4-007 | Customer reservation: exactly 30 minutes; provider Session and promoted allocation expiries equal before URL exposure | Locked by migration and runtime | Payments/operations owner verifies provider Session expiry in test mode and the provisional-success/local-failure compensation path | FEATURE_BLOCKING |
| CFG-C4-008 | Sender: `ApplyPack <orders@applypack.work>`; monitored reply-to: `help@applypack.work` | Exact defaults and ApplyPack-owned-domain validation implemented | Communications owner verifies the sender/domain and monitored mailbox, sends approved safe test messages, and records provider delivery evidence | FEATURE_BLOCKING |
| CFG-C4-009 | SPF, DKIM, and DMARC for `applypack.work`; open and click tracking disabled | No DNS or provider setting changed | Communications/security owner verifies DNS alignment and provider settings, including absence of rewritten token-bearing links or tracking resources | RELEASE_BLOCKING |
| CFG-C4-010 | Email submission must support immutable outbox-ID idempotency plus accepted-send reconciliation | Database flag defaults false; outbox claims are blocked until an approval reference exists | Communications owner documents the provider guarantee and reconciliation procedure, sets the approved non-secret reference, then tests accepted-send/worker-crash replay without a second accepted send | RELEASE_BLOCKING |
| CFG-C4-011 | Secure access capability TTL: exactly 15 minutes | Locked by migration and tests | Auth owner verifies production email/link latency, one-time consumption, token removal, and non-enumerating resend | FEATURE_BLOCKING |
| CFG-C4-012 | Release verification TTL: exactly 3,600 seconds | Exact environment/schema bound implemented | Search operations owner approves the value together with source-specific current verification procedures and exercises immediately-before-release closure replacement | RELEASE_BLOCKING |
| CFG-C4-013 | Durable worker identity: unique stable `APP_CHUNK4_WORKER_ID`; scheduler invokes `/api/cron/maintenance` with protected `CRON_SECRET` | Both values blank; worker is disabled | Operations owner provisions one topology, bounds concurrency, proves lease contention/crash/catch-up, and connects lag, deadline, refund, capacity, stale-review, and dead-letter alerts | RELEASE_BLOCKING |
| CFG-C4-014 | Checkout flags: `APP_PAYMENT_MODE=disabled`, `APP_CHECKOUT_ENABLED=false`, `APP_LIVE_PAYMENTS_ENABLED=false` until a separate activation | Safe defaults retained | Release owner may change these only after every blocking row and the wider release checklist are verified under separate authorization | BOOT_BLOCKING |

## Change control

Every change requires the stable ID, approving owner, non-secret evidence, validation update, version bump, and fresh test date. A missing or malformed required value fails according to its recorded fail mode; it never falls back to an invented product rule.
