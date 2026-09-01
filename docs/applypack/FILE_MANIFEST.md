# ApplyPack Codex Handoff File Manifest

This package is designed to be extracted directly into:

```text
C:\Users\mskir\Desktop\Apply_Pack\Chat docs
```

## Core authority documents

| File | Purpose |
|---|---|
| `00_START_HERE.md` | Reading order, authority order, local paths, execution rules, and definition of complete. |
| `01_PRODUCT_SOURCE_OF_TRUTH.md` | Locked product, pricing, turnaround, matching, corrections, refund, truth, and no-guarantee rules. |
| `02_SITE_COPY_AND_PAGE_MAP.md` | Approved public copy, page routes, metadata, calls to action, and visual requirements. |
| `03_CUSTOMER_AND_ADMIN_WORKFLOWS.md` | Complete customer journey, intake, private workspace, job selection, delivery, corrections, and admin operations. |
| `04_BACKEND_ARCHITECTURE_AND_DATA_MODEL.md` | Recommended compatible architecture, database entities, APIs, permissions, storage, capacity, deadlines, and state machines. |
| `05_PAYMENTS_EMAIL_DNS_AND_OPERATIONS.md` | Stripe checkout and webhooks, transactional and human email, DNS safety, deadlines, refunds, and runbooks. |
| `06_SECURITY_PRIVACY_ACCESSIBILITY_SEO.md` | Security, privacy, WCAG 2.2 AA, ADA Title III readiness, noindex rules, structured data, and performance requirements. |
| `07_TEST_PLAN_AND_SHIP_CHECKLIST.md` | Unit, integration, end-to-end, payment, email, accessibility, security, SEO, production, and independent audit gates. |
| `08_PREFLIGHT_QUESTIONS_AND_CREDENTIALS.md` | One consolidated list of repository, provider, login, authorization, and unresolved product questions. |
| `09_ENVIRONMENT_VARIABLES_TEMPLATE.md` | Provider-neutral environment-variable contract without secret values. |
| `10_DESIGN_MD_HANDOFF.md` | Rules for the user's forthcoming `DESIGN.md` and its authority over visual implementation. |

## Agent and execution documents

| File | Purpose |
|---|---|
| `AGENTS.md` | Repository-level rules for all coding agents working on ApplyPack. |
| `CODEX_MASTER_BUILD_PROMPT.md` | Full Codex execution prompt in Markdown. |
| `CODEX_MASTER_BUILD_PROMPT.txt` | Plain-text copy of the same full Codex prompt for easy pasting. |
| `README_DOWNLOAD_AND_USE.md` | Exact extraction, placement, design-file, and Codex-start instructions. |

## Package verification

| File | Purpose |
|---|---|
| `FILE_MANIFEST.md` | This file. |
| `SHA256SUMS.txt` | SHA-256 hashes for detecting accidental file changes after download. |

## Important local paths

```text
Handoff folder:
C:\Users\mskir\Desktop\Apply_Pack\Chat docs

Reusable repository and skill library:
C:\Users\mskir\Desktop\Repos

User-created visual authority:
C:\Users\mskir\Desktop\Apply_Pack\Chat docs\DESIGN.md
```

The exact ApplyPack website repository and GitHub remote are intentionally not guessed. Codex must inspect read-only first, then ask for those paths and all remaining provider access in one consolidated preflight.
