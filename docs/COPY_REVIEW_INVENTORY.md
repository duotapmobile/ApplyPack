# ApplyPack copy review inventory

Schema is controlled by Part I. Customer copy may not use an em dash. `APPROVED_EXACT` means the corrected contract supplies exact text. `SOURCE_REVIEW_REQUIRED` means a private source exists but later implementation must reconcile it to Part I before publication.

| Stable ID | Exact text or normalized hash | Route/state/trigger | Controlling source | Approval status | Version |
| --- | --- | --- | --- | --- | --- |
| COPY-001 | `ApplyPack` | Global brand | Part I locked facts | APPROVED_EXACT | 2026-09-04 |
| COPY-002 | `Resume + Cover Letter Pack` | Materials product labels | Part I locked facts | APPROVED_EXACT | 2026-09-04 |
| COPY-003 | `$20 once` | Search offer/checkout | Part I locked facts | APPROVED_EXACT | 2026-09-04 |
| COPY-004 | `10 researched job matches` | Search offer | Part I locked facts | APPROVED_EXACT | 2026-09-04 |
| COPY-005 | `No subscription` | Search offer | Part I locked facts | APPROVED_EXACT | 2026-09-04 |
| COPY-006 | `$8 per job` | Materials offer | Part I locked facts | APPROVED_EXACT | 2026-09-04 |
| COPY-007 | `Start your search` | Primary CTA/Step 1 | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-008 | `What work would you like to do?` | Step 2 | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-009 | `Confirm your experience and skills` | Step 3 | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-010 | `Choose your work preferences` | Step 4 | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-011 | `Help me decide from my experience` | Desired-work alternate path | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-012 | `Do not show me` | Explicit avoided-work gate | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-013 | `Dealbreaker` | Explicit hard-preference control | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-014 | `ADJACENT_OPPORTUNITIES` | Internal only; never customer-visible | Part I | APPROVED_INTERNAL_ONLY | 2026-09-04 |
| COPY-015 | `Limited exact fit` | Feasibility outcome | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-016 | `Exact requirement unknown` | Unknown-resolution state | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-017 | `Needs your confirmation` | Evidence-confirmation state | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-018 | `Refund problem` | Failed refund aggregate | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-019 | `Delayed` | Derived transient portal view only | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-020 | `Private files` | Upload/privacy reassurance | Part I/corrected copy source | SOURCE_REVIEW_REQUIRED | 2026-09-04 |
| COPY-021 | `Optional` | Prior-cover-letter label | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-022 | `Fact extraction only` | Prior-cover-letter default | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-023 | `Fact plus voice` | Prior-cover-letter opt-in | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-024 | `Neither / delete` | Prior-cover-letter choice | Part I | APPROVED_EXACT | 2026-09-04 |
| COPY-025 | `References available on request` | Resume output | Part I | PROHIBITED | 2026-09-04 |
| COPY-026 | `Caregiver` or `stay-at-home parent` as occupational experience | Candidate facts/resume output | Part I research safeguards | PROHIBITED_AS_INVENTED_EXPERIENCE | 2026-09-04 |
| COPY-027 | SHA-256 `44d228f0399e1c7e96e9ba0b985e6fe0912e112680ad2a875eb195e488317096` | Homepage/process/founder/FAQ source set | Private corrected copy source | SOURCE_REVIEW_REQUIRED | 2026-09-04 |
| COPY-028 | SHA-256 `12583423e060e65440eeef74c8c7f19e047feaa87d7746964f183c712f5cae30` | Intake/checkout/email source set | Private intake source subordinate to Part I | SOURCE_REVIEW_REQUIRED | 2026-09-04 |

Later chunks add every new customer-visible string, state, validation, warning, email, legal consent, and artifact label before release. Hash-only rows avoid copying private source bodies into the repository.

