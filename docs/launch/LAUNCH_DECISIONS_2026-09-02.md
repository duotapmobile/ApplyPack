# ApplyPack launch decisions

Status date: September 2, 2026

Operator: DuoTap LLC d/b/a ApplyPack

This is an implementation record, not legal or tax advice and not an attorney approval.

## Public address

ApplyPack will not publish the founder's residential address by default.

The launch email set is limited to authentication, receipts, order status, delivery, correction, conflict, security, and direct support replies. These messages must remain transactional or relationship messages and must not include promotional sections. The FTC says a message whose primary purpose is transactional or relationship content is exempt from most CAN-SPAM requirements; commercial email must include a valid physical postal address. If ApplyPack later sends marketing email, it must first obtain and publish a compliant business street address, registered USPS post-office box, or registered commercial-mail-receiving-agency mailbox and add compliant identification and opt-out handling.

Stripe can require non-public legal-entity, representative, and address information for account verification. That information must be entered only through Stripe's secure authenticated flow. Before live mode, review Stripe's customer-facing public details and a sample receipt to confirm no residential address is exposed. If Stripe requires a separate public support address, stop for the founder to choose a non-residential address.

No current implementation requirement justifies adding a street address to the website's public Terms, Privacy Policy, accessibility statement, or transactional templates. Attorney review should confirm state-specific notice requirements before final legal publication.

Authoritative references:

- FTC CAN-SPAM compliance guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- Stripe account onboarding and verification overview: https://docs.stripe.com/get-started/account
- Stripe statement descriptor requirements: https://docs.stripe.com/get-started/account/statement-descriptors

## Sales tax

Stripe Tax is not enabled automatically. Checkout remains server-priced at $20 and $8 with no client-controlled price or quantity.

Current Florida Department of Revenue guidance does not specifically classify a personalized job-search research service combined with customer-specific resume and cover-letter documents. Florida lists particular taxable services and explains that service taxability can depend on whether the service is part of a sale of tangible personal property. That general guidance is not specific enough to make a supportable ApplyPack classification. Other states can impose economic or physical nexus and service-specific rules.

Before the first live customer charge, the operator must obtain one of:

1. written classification guidance from the Florida Department of Revenue covering both ApplyPack products and delivery of editable DOCX files; or
2. written advice from a qualified state-and-local-tax professional covering the operator's state, customer sourcing, current nexus, and registration/collection obligations.

The advice must answer whether either product is taxable, where the sale is sourced, whether existing nexus requires registration before launch, and whether Stripe Tax or a simpler manual configuration is appropriate. Until that evidence exists, live customer payment acceptance is a tax launch blocker. Test-mode checkout, staging, provider configuration, accessibility, migration validation, and all non-live work continue.

Authoritative references:

- Florida sales and use tax overview: https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx
- Florida sales-tax registration: https://floridarevenue.com/taxes/eservices/Pages/registration.aspx
- Florida Department of Revenue technical assistance advisement explaining service/tangible-property analysis: https://floridarevenue.com/TaxLaw/Documents/25A-011.pdf

## Document safety and malware

Launch baseline cost: $0 incremental.

Implemented controls:

- PDF and DOCX extension, MIME, and file-signature agreement;
- 10 MB file and request-size limits;
- PDF rejection for JavaScript, launch actions, embedded files, rich media, XFA, encryption, and other active constructs;
- DOCX container-entry, expansion-ratio, path-traversal, macro, ActiveX, embedded-object, custom-UI, encryption, and executable rejection;
- randomized private storage keys, private buckets, authorization, time-limited signed access, retention, and operator lockout until checks pass;
- atomic scan-queue claims, capped retries, and explicit failed/blocked states.

Residual risk: structural validation is not an antivirus engine and cannot detect every novel or content-only malicious payload. Public and operator copy must call these controls document safety checks, not malware scanning.

Optional later hardening: connect ClamAV or a privacy-reviewed scanning provider only after documenting exact monthly cost, retention and training terms, data region, failure behavior, test evidence, and the value compared with the current low-risk allowlist. A paid always-on Railway scanner is not required for this MVP based only on architectural preference.

## Monitoring

Start with Railway runtime/deploy logs, Supabase logs, Stripe webhook records, the admin failure queue, and hourly maintenance alerts to admin@applypack.work. Sentry may be added only on a free tier with server-side operational errors, aggressive PII scrubbing, no session replay, no behavioral analytics, and no customer documents, resume text, cover-letter text, or intake narrative.

## Legal review flags

Implementation can proceed, but counsel should review before final legal publication:

- limitation of liability and enforceability;
- state-specific cancellation, refund, automatic-renewal, and consumer-notice rules;
- privacy rights and processor disclosures for the actual customer jurisdictions;
- accessibility statement wording;
- final retention periods for transaction, audit, support, and delivered-document records;
- whether any state or provider requires a public non-residential mailing address.
