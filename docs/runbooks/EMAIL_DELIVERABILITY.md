# Email deliverability

## Scope

Covers sign-in codes, purchase receipts, status notices, delivery notices, refunds, disputes, and support mail in staging and production.

## Prerequisites

- Verified sender domain and monitored support/reply mailbox.
- Supabase SMTP and Resend identities approved for the target environment.
- Staging recipient allowlist with synthetic customer data only.
- Current Privacy/retention approval and incident owner.

## Procedure

1. Confirm target environment and that staging cannot send outside the allowlist.
2. Send one provider-backed message for each template class: sign-in, purchase, status, delivery, refund/dispute, and support.
3. Verify From, Reply-To, Message-ID, delivery status, template version, and link hostname. Do not put résumé content, correction details, or other private document text in logs or provider metadata.
4. Exercise retry, deduplication, delayed delivery, bounce, complaint, and permanent-failure handling.

## Verification

Record provider message IDs, timestamps, redacted recipient, inbox/spam outcome, SPF/DKIM/DMARC result, retry count, and application state. Configuration presence alone is not delivery proof.

## Failure and recovery

Pause affected outbound work, preserve the outbox item, correct sender/DNS/template configuration, and replay idempotently. Provide an operator-visible recovery path for sign-in and paid delivery.

## Stop conditions

Stop for account mismatch, non-allowlisted staging recipient, exposed private content, unauthenticated sender domain, unmonitored replies, or repeated blind retries.
