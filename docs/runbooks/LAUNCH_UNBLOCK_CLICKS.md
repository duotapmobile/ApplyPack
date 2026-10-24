# ApplyPack launch actions — September 22, 2026

Final reconciliation at 08:34 UTC: canonical desktop, GitHub main, staging and production all run 9cf14454425ff9b4b924c9ad6aeb9010f5ebcb31. PR 4 merged; all eight CI jobs passed. Production deployment bf2d101f-6d4a-4427-90f4-46e2470c56cb and staging deployment 0ba54c6b-9690-4139-bee4-d21218a49b7a succeeded. Public pages and liveness return 200; readiness returns 503. All purchasing and source-activation flags remain false. This runbook is not a readiness approval.

## Current verified state

| Aggregate | Staging | Production |
| --- | ---: | ---: |
| Registered sources | 80 | 79 |
| Employers | 76 | 75 |
| Jobs | 12 | 0 |
| Source verifications | 0 | 0 |
| Source schedules / enabled schedules | 0 / 0 | 0 / 0 |
| Scheduled commerce jobs | 0 | 0 |

Both current source-readiness RPCs return false for manualReady, automatedReady, jobSourcesRegistered and authorizedSourceInventory. Each project has nine current authorization heads: seven UNVERIFIED_DISABLED, one BLOCKED, one AUTHORIZED_MANUAL_ONLY. A manual-only label alone is not a completed authority/evidence/verification chain. Staging's earlier classified inventory consists of synthetic fixtures; no real verified inventory has been admitted.

Both commerce configurations return false for tax_configuration_approved, materials_generation_approved and provider_idempotent_email_approved. These require actual review/evidence, not blanket flag changes. No queued legacy retention kinds exist: the old compatibility RPC is not a current queue-churn blocker.

Private aggregate receipts: evidence/soft-opening/private/final-operations-counts.json and final-operations-railway.json. No customer rows or credentials were exported.

Domain verification is complete; do not repeat Namecheap contact verification or change nameservers. Liberation Sans is approved. Malware scanning is deferred to v2; isolated structural parsing remains mandatory and records NOT_SCANNED. Email delivery and the actual staging email-code sign-in flow have been exercised. These successes do not establish payment-to-delivery readiness.

## Existing AWS access: owner steps

1. Sign into the existing AWS account at https://console.aws.amazon.com/ and complete MFA.
2. Open Key Management Service, select the existing ApplyPack key's region, then Customer managed keys and the key. Supply its ARN and region as identifiers; never paste secret credentials in chat. Do not create a new key merely to satisfy this step.
3. In Railway, select project Apply Pack, environment staging, service ApplyPack-staging, then Variables. Configure existing narrowly scoped workload credentials securely: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN when temporary. Prefer an existing workload identity; never use root access keys.
4. IAM and the exact key policy must allow kms:Encrypt and kms:Decrypt. Use non-sensitive context application=ApplyPack and deployment=staging; production requires its own permitted context. Customer-scoped context is hashed by the adapter. Never put resume text, names or email addresses in encryption context.
5. Engineering sets APP_KMS_PROVIDER=aws, AWS_REGION, APP_KMS_KEY_IDENTITY, APP_KMS_KEY_VERSION, APP_KMS_ENCRYPTION_CONTEXT_VERSION and APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED=true, then records a real synthetic encrypt/decrypt round trip. A configured variable is not proof; never stamp a fabricated verification time.
6. If no suitable existing key/identity exists, prepare the exact resource, policy and cost for approval before creation.

Reference: https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html

## Isolated parser hosting: unresolved platform boundary

Staging emitted document_isolation_probe_failed / namespace_or_permission_denied at 07:08 UTC on revision 80e1f76428976c47dfec40ebba1bcd52f7b42964. The current Railway runtime denied the required Linux namespace isolation. Installing binaries or deferring malware scanning does not resolve it.

Open Railway project Apply Pack > staging > ApplyPack-staging > deployment logs to inspect the sanitized diagnostic. Identify an existing approved Linux execution environment that supports isolation, or obtain approval for a concretely priced isolated worker. Engineering can wire and test that environment once access exists. Do not disable isolation or mark quarantined uploads clean to bypass the gate.

Liberation Sans, LibreOffice and Poppler require no Arial purchase. Linux CI rendering produced seven artifacts across eight pages; deployed runtime verification and human content/visual release approval remain distinct. Renderer entrypoint hashes are not a complete software supply-chain attestation.

## Scheduled maintenance: staging exists, production does not

Existing staging service ApplyPack-maintenance (866e36fd-2fec-45fd-ba01-7150a789e419) uses cron */15 * * * *, repository root /, build node --check scripts/run-maintenance-once.mjs, start node scripts/run-maintenance-once.mjs, no web healthcheck and restart NEVER. It is deployed successfully on merged revision 9cf1445.

Its natural run at 08:30:24 UTC on the merged revision reported BLOCKED, ready=false, HTTP 503 for rendering, encryption, file safety and payment-integrity readiness. All action counts were zero. A known dependency hold exits normally; it is not evidence of a healthy fulfillment service or successful heartbeat.

Production contains only ApplyPack web (793579f2-525f-463f-90ac-cf6689433cc3); no maintenance instance exists. Web deployment is now verified at merged revision 9cf1445. APP_PAYMENT_MODE was corrected from disabled to test for operational webhook processing; checkout, live-payment and source-activation flags remain false. Do not set APP_PAYMENT_MODE=disabled during rollback while existing obligations need reconciliation.

After production deployment and dependency verification, open Railway > Apply Pack > production. Prepare a production instance of the existing maintenance service, preserving the service identity and using the reviewed production branch/revision. Review usage implications before applying. Set the same one-shot build/start, root /, 15-minute cron, no healthcheck and restart NEVER through supported service settings; securely set the exact production maintenance URL and matching CRON_SECRET. Do not copy staging secrets blindly, add a public domain, or create an unrelated duplicate service. Do not opt into deprecated railwayConfigFile settings. Verify deployed SHA, next scheduled time, then actual sanitized run output and real server heartbeat separately.

## Real sourcing pilot: retrieval demonstrated, inventory still pending

VIPdesk's official current-openings page identifies the vipdesk Lever tenant. Published Lever API documentation permits third-party retrieval: https://github.com/lever/postings-api. The bounded actual adapter pilot retrieved two postings from one API page and normalized both, retaining raw payloads, hashes and provenance privately. This did not write a database authorization or ingestion record.

At 07:53:24 UTC, one additional GET to https://jobs.lever.co/vipdesk/dfa736ae-0f95-4ff1-8c99-4866ad321726/apply returned HTTP200 with the Technical Customer Service Representative (Remote) title and application form. Receipt: evidence/soft-opening/private/vipdesk-technical-application-1790063604552/receipt.json; response SHA256 dffceedc6bac1e2c6d6ea700394dc2e089426849765dee0eff22c9ca081ca86a. Total pilot across both steps: three HTTP requests, no submissions, cookies, database ingestion, scheduled activation, customer publication or assertion of paid-display rights. General Application is not being represented as a suitable open vacancy.

Next engineering step: document truthful source/employer identity, permitted actions/hosts and evidence scope; independently review current job and application facts, preserve unknown fields, then use the authorized manual source-observation workflow. Admit only verified snapshots into customer-owned inventory and evaluate actual criteria separately. Public retrieval permission does not establish paid republication rights or customer fit. Any source agreement request must be explicitly authorized before sending.

## Remaining staging fulfillment and release proof

Keep checkout/live activation disabled until the dependencies and applicable approvals are demonstrated. Use the existing Stripe test account for a genuine test checkout-to-webhook-to-order-to-reviewed-delivery journey with synthetic candidate data, authenticated customer ownership and fresh-authentication downloads. No live purchase is required.

Earlier Stripe accepted two resends of an existing price.created TEST event, but no receiving ledger row appeared; that is not transport/replay proof. The invalid-signature check returned400. Existing production TEST endpoint subscriptions were repaired; this did not enable live payments. A mailbox delivery or configured email provider does not establish provider idempotency approval.

Engineering must refresh the final exact deployment SHA, readiness response, source admission/coverage, renderer and isolated parser evidence, KMS round trip, actual scheduled execution, payment/email idempotency and customer-isolated end-to-end release before declaring the paid launch ready. Completed pressure/browser/database tests do not substitute for those blocked provider paths.

Email follow-up: two authorized identical Resend requests returned the same provider message ID; one matching message arrived with SPF/DKIM/DMARC PASS but landed in Gmail Spam. Do not claim inbox delivery or mark application-outbox approval from this alone. Rehearse the actual transaction emails, inspect placement and delivery records, then record an evidence-based approval. No mailbox labels were changed. Production is currently Stripe TEST mode; approved live credentials/prices/webhook and activation follow acceptance, never precede it.
