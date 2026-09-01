# How to Use This ApplyPack Codex Handoff

## 1. Download and extract

Extract the package contents into:

```text
C:\Users\mskir\Desktop\Apply_Pack\Chat docs
```

The files should sit directly inside that folder.

## 2. Create your design authority

Create your separate design file as:

```text
C:\Users\mskir\Desktop\Apply_Pack\Chat docs\DESIGN.md
```

Also place a copy at the confirmed ApplyPack website repository root before Codex changes the public design.

Your `DESIGN.md` should control visual presentation. Do not repeat backend logic there unless the visual behavior requires it.

## 3. Use the agent file

The included:

```text
AGENTS.md
```

is intended for the ApplyPack repository root.

When the repository already has a root `AGENTS.md`, Codex must merge the ApplyPack rules into it and preserve any stricter existing guidance. Do not blindly overwrite repository-specific instructions.

## 4. Start a new Codex conversation

Open:

```text
CODEX_MASTER_BUILD_PROMPT.txt
```

Copy the full contents into a new Codex conversation.

The first Codex response should be one consolidated preflight covering:

- Repository path and GitHub
- Hosting
- Domain and DNS
- Stripe
- Email
- Backend provider
- Authentication
- Product decisions
- 24-hour capacity
- Security and monitoring
- Deployment permission
- Live verification permission

It should not begin editing before the preflight is answered.

## 5. Answer once

Provide all requested login confirmations, business decisions, and external-action permissions in one response.

Do not paste secret keys or passwords into chat.

Log in directly to providers or use the secure provider and CLI flow Codex identifies.

## 6. Expected behavior after preflight

Codex should:

- Record decisions.
- Inspect the repository.
- Preserve the site and `DESIGN.md`.
- Build the backend.
- Configure payments.
- Configure customer and admin access.
- Configure secure uploads and delivery.
- Build the admin workflow.
- Configure email and DNS when authorized.
- Test all flows.
- Deploy.
- Run audits.
- Produce ship evidence.

It should not stop after a plan.

## 7. Files in this package

```text
00_START_HERE.md
01_PRODUCT_SOURCE_OF_TRUTH.md
02_SITE_COPY_AND_PAGE_MAP.md
03_CUSTOMER_AND_ADMIN_WORKFLOWS.md
04_BACKEND_ARCHITECTURE_AND_DATA_MODEL.md
05_PAYMENTS_EMAIL_DNS_AND_OPERATIONS.md
06_SECURITY_PRIVACY_ACCESSIBILITY_SEO.md
07_TEST_PLAN_AND_SHIP_CHECKLIST.md
08_PREFLIGHT_QUESTIONS_AND_CREDENTIALS.md
09_ENVIRONMENT_VARIABLES_TEMPLATE.md
10_DESIGN_MD_HANDOFF.md
AGENTS.md
CODEX_MASTER_BUILD_PROMPT.md
CODEX_MASTER_BUILD_PROMPT.txt
README_DOWNLOAD_AND_USE.md
```

## 8. Product rules already embedded

```text
$20 for exactly 10 job matches
24-hour search turnaround
$8 for each selected resume and cover-letter set
24-hour Apply Pack turnaround
Customer chooses jobs after seeing all 10
No subscription
No auto-apply
No outcome guarantee
Private customer portal
Admin job-match and document-delivery workflow
Capacity control before payment
Secure uploads and downloads
One bounded factual-correction flow, pending final confirmation
```
