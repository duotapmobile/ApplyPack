# ApplyPack Build Handoff, Start Here

Last updated: September 1, 2026

## Purpose

This folder is the complete product, copy, backend, operations, security, accessibility, payment, email, DNS, testing, and launch handoff for ApplyPack.

ApplyPack is not only a job search tool and not only a resume-writing service. It handles the work between knowing a customer needs a job and having a truthful, job-specific application ready to submit.

The core promise is:

> We find the jobs. We get you ready to apply.

## Required local locations

The user will place these files in:

```text
C:\Users\mskir\Desktop\Apply_Pack\Chat docs
```

The user's reusable repository and skill library is located at:

```text
C:\Users\mskir\Desktop\Repos
```

The exact ApplyPack website repository path and GitHub remote are not yet embedded in these documents. The executing agent must ask for both in its single preflight question set before making changes.

## Required reading order

Before planning, editing, installing packages, creating accounts, changing DNS, or writing code, read every file in this folder in this order:

1. `00_START_HERE.md`
2. `01_PRODUCT_SOURCE_OF_TRUTH.md`
3. `02_SITE_COPY_AND_PAGE_MAP.md`
4. `03_CUSTOMER_AND_ADMIN_WORKFLOWS.md`
5. `04_BACKEND_ARCHITECTURE_AND_DATA_MODEL.md`
6. `05_PAYMENTS_EMAIL_DNS_AND_OPERATIONS.md`
7. `06_SECURITY_PRIVACY_ACCESSIBILITY_SEO.md`
8. `07_TEST_PLAN_AND_SHIP_CHECKLIST.md`
9. `08_PREFLIGHT_QUESTIONS_AND_CREDENTIALS.md`
10. `09_ENVIRONMENT_VARIABLES_TEMPLATE.md`
11. `10_DESIGN_MD_HANDOFF.md`
12. `AGENTS.md`
13. `CODEX_MASTER_BUILD_PROMPT.md`

Then inspect the ApplyPack repository and read all repository-local guidance, including every applicable `AGENTS.md`, `README`, `START_HERE`, `PROJECT_MAP`, `PROJECT_STATUS`, `RECOVERY`, `.agent-guidance`, package manifest, deployment configuration, environment example, migration folder, and test configuration.

## Authority order

When instructions conflict, use this order:

1. The user's latest direct instruction in the active Codex conversation
2. The user's `DESIGN.md`, for visual design and responsive presentation only
3. `01_PRODUCT_SOURCE_OF_TRUTH.md`, for product rules, prices, promises, scope, and customer outcomes
4. `02_SITE_COPY_AND_PAGE_MAP.md`, for approved wording, information hierarchy, routes, and calls to action
5. `03_CUSTOMER_AND_ADMIN_WORKFLOWS.md`, for functional behavior
6. `04_BACKEND_ARCHITECTURE_AND_DATA_MODEL.md`, for backend requirements and recommended defaults
7. `05_PAYMENTS_EMAIL_DNS_AND_OPERATIONS.md`, for provider integration and operations
8. `06_SECURITY_PRIVACY_ACCESSIBILITY_SEO.md`, for nonfunctional requirements
9. `07_TEST_PLAN_AND_SHIP_CHECKLIST.md`, for completion criteria
10. Existing repository behavior, only where it does not conflict with the authorities above

Do not silently resolve a material conflict. Record the conflict and the chosen controlling instruction in the implementation decision log.

## Design authority

The user will create a separate `DESIGN.md`. Do not invent a new brand, layout system, color palette, type system, or visual direction when that file exists.

Backend work may proceed before `DESIGN.md` is complete only when the work does not require changing approved visual presentation. Preserve the current site and add accessible functional states using its existing components until `DESIGN.md` supplies different instructions.

## Repository library rules

The agent may inspect `C:\Users\mskir\Desktop\Repos` in read-only mode to find reusable skills, conventions, utilities, test patterns, and integration examples.

The agent must:

- Inventory top-level repositories before searching deeply.
- Read applicable guidance inside a repository before using a pattern from it.
- Never edit a repository other than the confirmed ApplyPack repository.
- Never copy secrets, customer data, generated credentials, build artifacts, or private environment files.
- Never copy code with an incompatible license.
- Prefer a small, compatible adaptation over importing a large subsystem.
- Record reused patterns and their source repository in the implementation log.
- Treat code from other repositories as reference material, not automatic authority.

## One preflight, then continuous execution

The executing agent must ask all access, login, deployment, billing, and unresolved product questions in one consolidated message before implementation.

After the user answers that preflight, the agent must not stop after creating a plan. It must continue through implementation, migrations, provider configuration, tests, deployment, DNS, email, payment verification, production smoke tests when authorized, accessibility review, documentation, and final ship-readiness reporting.

The agent may ask another question only when all of the following are true:

- The issue could not reasonably have been included in the initial preflight.
- No safe, reversible default is available.
- Guessing could cause data loss, financial loss, a security failure, a legal misrepresentation, or an external account change the user did not authorize.

Otherwise, make the safest reversible decision consistent with these documents, record it, and continue.

## Definition of complete

The project is not complete because pages render or because a payment button opens.

Complete means:

- The existing public site remains intact and follows `DESIGN.md`.
- A customer can verify an email address and start an intake.
- A customer can upload a current resume and optional cover letter securely.
- The intake captures required preferences, dealbreakers, background, and search direction.
- The customer reviews and approves exact search criteria before payment.
- A successful $20 payment creates a real search order with a 24-hour deadline.
- The admin can prepare, quality-check, and deliver exactly 10 job matches.
- The customer can securely view the 10 matches.
- The customer can mark a match Not for Me without an automatic replacement.
- The customer can report a material conflict with an approved non-negotiable.
- The customer can select one or more jobs for $8 Apply Packs.
- Capacity is checked before the second checkout.
- Successful payment creates one Apply Pack order per selected job, each with a 24-hour deadline.
- The admin can upload and deliver the correct resume and cover letter for each selected job.
- The customer can securely download the correct files.
- One bounded factual-correction request flow works.
- Stripe webhooks are verified, idempotent, and tested.
- Transactional email is authenticated and tested.
- Private data is protected with server-side authorization and row-level rules when supported.
- Public and private routes have correct indexing behavior.
- WCAG 2.2 Level AA requirements are tested manually and automatically.
- DNS, HTTPS, email authentication, environment variables, monitoring, backups, and recovery instructions are documented.
- Production deployment is verified end to end.
- There are no known critical or high-severity defects.
- The final report includes exact evidence, remaining risks, and any external step the user must still complete.

## Files to copy into the repository

The executing agent should copy this handoff into a repository documentation folder, for example:

```text
docs/applypack/
```

The included `AGENTS.md` is intended for the confirmed ApplyPack repository root. Before overwriting an existing root `AGENTS.md`, merge the rules carefully and preserve any stricter repository-specific instructions.
