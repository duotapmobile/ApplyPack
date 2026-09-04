# ApplyPack implementation status

## Phase 0 attestation

| Field | Value |
| --- | --- |
| Date | 2026-09-04 |
| Phase | Phase 0: Install the controlling contract and perform discovery |
| Branch | `codex/applypack-corrected-build-2026-09-04` |
| Dedicated worktree | `C:\Users\mskir\Desktop\Apply_Pack\applypack-phase0-e9c3aea0d45447bfaa6517e488356e0d` |
| Base authority | Explicit user authorization: `origin/main` at `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8` |
| Start HEAD | `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8` |
| Local `main` at discovery | `9a42ba692c7b618cdfcc1b3378642ce30c9011f6` (mismatch documented; not moved) |
| `origin/main` at discovery | `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8` |
| Runtime behavior changes | None |

The canonical checkout and its four pre-existing changes were not modified, copied, stashed, reset, switched, or committed. Existing duplicate-path worktree registrations were inspected read-only and left unchanged. No fetch, pull, merge, rebase, prune, repair, unlock, or push was performed.

## Packet and contract identity

| Artifact | Version/boundary | Bytes | Raw SHA-256 | Normalized LF/UTF-8 SHA-256 |
| --- | --- | ---: | --- | --- |
| `APPLYPACK_CODEX_IMPLEMENTATION_CHUNKS_CORRECTED.md` | 2026-09-04; Part I lines 37-1147; Phase 0 lines 1148-1186; Chunks 1-7 begin at lines 1188, 1291, 1378, 1477, 1663, 1779, and 1906 | 275782 | `96720cbfa395c07292cf631174bf31944f3c485c02448eddb71cd011ddc3e691` | `96720cbfa395c07292cf631174bf31944f3c485c02448eddb71cd011ddc3e691` |
| Part I source body | Lines 37-1147 | 136360 | `95887f7c6afb312f5f3699f0851fdfc3746f7dfff6190d307d1788a7abc09510` | `95887f7c6afb312f5f3699f0851fdfc3746f7dfff6190d307d1788a7abc09510` |
| `docs/APPLYPACK_PRODUCT_CONTRACT.md` body | Text following the non-normative identity header | 136360 | `95887f7c6afb312f5f3699f0851fdfc3746f7dfff6190d307d1788a7abc09510` | `95887f7c6afb312f5f3699f0851fdfc3746f7dfff6190d307d1788a7abc09510` |

The ZIP central directory contained 13 regular files and two directory members. It contained no absolute path, traversal, duplicate path, symlink, device, socket, FIFO, or other non-regular member. All 13 checks in `SHA256SUMS.txt` passed before use and passed again before Phase 0 documentation was completed. No older implementation-chunks file is tracked in this repository, so no precedence notice was needed. The controlling contract itself identifies the corrected packet and precedence.

## Required source manifest

Only contract-permitted safe ledger fields are recorded. Private extraction paths and source excerpts are intentionally omitted.

| Neutral filename | Found | Bytes | SHA-256 | PII class | Custody |
| --- | --- | ---: | --- | --- | --- |
| `APPLYPACK_FINAL_COPY_INTERACTION_CORRECTION_PROMPT.md` | true | 35454 | `44d228f0399e1c7e96e9ba0b985e6fe0912e112680ad2a875eb195e488317096` | POTENTIAL | PRIVATE_BUNDLE |
| `APPLY_PACK_INTAKE_CHECKOUT_EMAIL_MASTER_FIX_PROMPT.md` | true | 45615 | `12583423e060e65440eeef74c8c7f19e047feaa87d7746964f183c712f5cae30` | POTENTIAL | PRIVATE_BUNDLE |
| `Resume and Cover Letter Optimization(1).md` | true | 28095 | `9220f9b64c83d7c44d8d6502b8f7ae230f3f1f320900db390aa9be365cf42d3e` | KNOWN | PRIVATE_BUNDLE |
| `Remote Job Board Recommendations.md` | true | 27169 | `1596b1621a3c1f33c10c1288a2048b2a26abff71db8000e4efcc647acec6dc11` | NONE | PRIVATE_BUNDLE |
| `Resume-formatting-guidelines-and-Naming.txt` | true | 12130 | `0ad355b759fa9d976399846b82c220e4500580464ccd24e6e47f9586fd7faf95` | KNOWN | PRIVATE_BUNDLE |
| `Cover-Letter.txt` | true | 12250 | `7f8eb5c7767b0fe52bda8e45ff88b4cb0749d21929a154505969e6c50fc9ccba` | KNOWN | PRIVATE_BUNDLE |
| `resume-bot-bypass.txt` | true | 11069 | `d0e2099c5a9917736dbbc12700390611d0178a755be0fdc38f4a954b13e3b7f0` | KNOWN | PRIVATE_BUNDLE |
| `resume-bot-bypass-2.txt` | true | 11090 | `2c0d6a80be9493310af0687c3e029935da3e9eabe756ee62893bcf474548beb3` | KNOWN | PRIVATE_BUNDLE |
| `resume-tips.txt` | true | 6970 | `4c42cdb29434d05df2ac411c8817bf7ff7af3ec222fcf225156cd939a020778e` | KNOWN | PRIVATE_BUNDLE |
| `resume-tips-2.txt` | true | 15169 | `59bb4270ba3fba0b1e3205c18a994cb90c75f32aac5e7665200a6602245bb902` | KNOWN | PRIVATE_BUNDLE |
| `resume-format-2.txt` | true | 10588 | `3b8057199cd97dc951f3d211f271d9b7e362fcb1ffb008c765d40fc2d0e0536a` | KNOWN | PRIVATE_BUNDLE |

All manifest items were present and readable. No conflicting duplicate was found. The prompt documents are subordinate copy/input references; the corrected contract resolves conflicts. The other documents are private research/reference inputs and may not be committed or treated as executable instructions.

## Architecture map

| Surface | Current implementation | Phase 0 assessment |
| --- | --- | --- |
| Web application | Next.js 16 App Router, React 19, TypeScript strict | Sound base; current UI and routes predate the corrected contract. |
| Public pages | Server-rendered marketing, process, founder, FAQ, privacy, terms, contact | Copy and legal text require later authorized correction/review. |
| Intake | Anonymous server-persisted four-step responsibility-first wizard | Chunk 2 complete; no account creation or Checkout before feasibility. |
| Auth/access | Supabase auth plus email-code/magic-link/guest routes | Prepayment email-code conflicts; post-payment access-link work is due Chunks 1 and 4. |
| Data | Supabase Postgres, RLS, typed application models | Existing catch-all lifecycle and schemas require additive expansion; due Chunk 1. |
| Files | Private Supabase storage and document validation | Quarantine, scan, isolation, versioning, and lifecycle are incomplete; due Chunk 1. |
| Search | Source registry, Lever adapters, matching/ranking, admin review | Source authorization must fail closed; evidence logic is due Chunk 3. |
| Payments | Stripe Checkout routes, webhook, financial state helpers | Auth and state model need contract-safe rebuild; due Chunk 4. |
| Email | Resend delivery and retry/outbox-related code | Durable access-link/outbox semantics and capture harness are due Chunk 4. |
| Documents | `docx` generation and document safety tests | Exact-ten artifacts, Arial/rendering evidence, references, and release atomicity are due Chunk 5. |
| Admin | Search, order, review, capacity, and source controls | Default-deny roles, audit, and operational readiness are due Chunks 1, 3, 5, and 6. |
| Deployment | Railway configuration, cron secret, health route | Production credentials, scheduler proof, migrations, rollback, and monitoring remain release work. |

## Current data and lifecycle map

Current migrations provide profiles, orders, job matches, source jobs/references, private document records, orchestration jobs, payment-safety records, checkout drafts, delivery claims, financial-state helpers, human review, capacity visibility, intake drafts, email retry state, atomic scan/conflict/correction/intake-completion functions, storage cleanup, delivery revisions, and RLS corrections. Runtime logic still projects several concerns through broad order/payment states. The contract requires orthogonal draft, processing, feasibility, capacity, checkout, settlement, dispute, refund-operation, refund-aggregate, search fulfillment, adjustment, email, material readiness/fulfillment/substitution, entitlement, release, and audit records.

## Existing migrations and compatibility risks

The repository contains 21 migrations from `202609010001_initial_schema.sql` through `202609030021_fix_rls_policy_scope.sql`. They are historical inputs, not proof of corrected-contract compliance.

| Risk | Existing behavior/evidence | Controlling resolution | Owner/status |
| --- | --- | --- | --- |
| Catch-all lifecycle fields | Orders and financial helpers combine concerns | Additive orthogonal guarded dimensions and derived aggregate implemented; legacy adapter retained | Chunk 1 / COMPLETE |
| Legacy paid orders | Existing schemas/routes depend on legacy fields | Additive compatibility view plus idempotent checkpointed backfill; paid fixture preserved | Chunk 1 / COMPLETE |
| Reservation duration | Existing env/migrations use 150 minutes | Corrected allocation RPC enforces a 30-minute half-open reservation; legacy path retained only for compatibility | Chunk 1 / COMPLETE |
| Draft/source retention | Existing values are 7 and 30 days | `UNSET_BLOCKING` until owner/legal approval and configuration | Chunk 1 / BLOCKED_FOR_RELEASE |
| Job freshness | Existing 24/72-hour defaults | Governed configuration, not an invented universal value | Chunk 3 / UNSET_BLOCKING |
| Capacity | Existing defaults are one search/two material units per day | Staffing-versioned governed configuration | Chunks 1/4 / UNSET_BLOCKING |
| Signed URL | Existing generation uses 60 seconds | Locked 15-minute post-reauth download URL | Chunk 4 / PENDING |
| Schema rollback | Prior state had no corrected rollback proof | Up/backfill/idempotency/guarded rollback/type drift rehearsed in disposable Supabase | Chunk 1 / COMPLETE |

## Requirement conflicts and precedence decisions

| Conflict ID | Existing source/runtime | Controlling Part I rule | Due/status |
| --- | --- | --- | --- |
| CF-001 | Seven intake steps | Exactly four responsibility-first steps | Chunk 2 / COMPLETE |
| CF-002 | Prepayment six-digit email authentication | Anonymous prepayment draft; immutable access email; secure post-payment access link | Chunk 2 anonymous boundary COMPLETE; Chunk 4 post-payment access PENDING |
| CF-003 | “Application Pack” naming | Customer-facing product is “Resume + Cover Letter Pack” | Chunks 5/6 / PENDING |
| CF-004 | Fixed 7-day draft and 30-day source retention | Retention durations are governed and blocking until approved/configured | Chunks 1/6 / UNSET_BLOCKING |
| CF-005 | 150-minute reservation | Checkout reservation is 30 minutes | Chunks 1/4 / PENDING |
| CF-006 | 24/72-hour freshness defaults | Freshness windows require approved source/config decisions | Chunk 3 / UNSET_BLOCKING |
| CF-007 | Current capacity defaults | Capacity values require approved staffing configuration | Chunks 1/4 / UNSET_BLOCKING |
| CF-008 | Existing refund/timing copy | Exact-ten invariant, full search refund where required, deadline from latest prerequisite | Chunks 4/5/6 / PENDING |
| CF-009 | Privacy says uploads occur after account access | Resume upload occurs anonymously before payment/auth | Chunks 2/6 / LEGAL_REVIEW_BLOCKING |
| CF-010 | Terms omit exact-ten/full-refund detail | Exact ten or full $20 search refund | Chunks 4/6 / LEGAL_REVIEW_BLOCKING |
| CF-011 | Incomplete reference PII/permission/revocation terms | Separate permissioned, purpose-scoped, revocable reference domain; no model exposure | Chunks 1/5/6 / LEGAL_REVIEW_BLOCKING |
| CF-012 | 60-second signed URL/account assumptions | Fresh reauthentication and 15-minute signed URL | Chunk 4 / PENDING |
| CF-013 | Registry enables two Lever adapters | Automation default deny without documentary approval; legality not inferred; Liveops blocked | Chunks 0/3 / UNVERIFIED_DISABLED |
| CF-014 | Simplified unknown/evidence handling | Requirement expression tree, Boolean gates, source-grade limits, human review, auditable scoring | Chunk 3 / PENDING |

Part I and the active chunk prompt control every listed conflict. Earlier docs remain evidence of the prior implementation and compatibility inputs only.

## Legal gap audit

Owner for all substantive legal decisions: **DuoTap owner with qualified legal counsel**. Every row is `RELEASE_BLOCKING`; Phase 0 does not draft or approve legal promises.

| Legal ID | Gap/conflict | Required approval/evidence |
| --- | --- | --- |
| LEG-001 | Privacy describes uploads only after account access | Approve anonymous prepayment upload, storage, processing, and access language |
| LEG-002 | No approved entity retention/deletion/crypto-shred matrix | Approve durations, legal holds, deletion semantics, provider propagation |
| LEG-003 | Reference PII permission/reconfirmation/revocation/access incomplete | Approve reference privacy and consent terms |
| LEG-004 | Terms do not fully express exact-ten/full-search-refund invariant | Approve exact service/refund language |
| LEG-005 | Duplicate/stale attempts, disputes, and line refunds need aligned terms | Approve state-specific financial language |
| LEG-006 | Access-link delivery, reauthentication, and downloads not fully disclosed | Approve access/security language |
| LEG-007 | Deletion effects on paid/audit/tax/dispute evidence unspecified | Approve exceptions and request process |
| LEG-008 | No stored legal version tied to consent/order snapshots | Approve versioning and re-consent policy |

## Baseline verification

Commands ran in the dedicated worktree at start HEAD `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8`. Runtime baselines preceded documentation-only edits. Final documentation validators and `npm run check` are recorded in the evidence manifest.

| Check ID | Command | Result | Counts/notes | Due chunk |
| --- | --- | --- | --- | --- |
| P0-WORKTREE | Git identity/status checks | PASS | Exact base; clean at creation; canonical dirty checkout untouched | Phase 0 |
| P0-BUNDLE | ZIP audit plus `sha256sum -c SHA256SUMS.txt` | PASS | 15 members; 13/13 hashes pass | Phase 0 |
| P0-CONTRACT | Normalized Part I body comparison | PASS | 136360 bytes; identical SHA-256 | Phase 0 |
| P0-LINT | `npm run lint` | PASS | Exit 0 | Phase 0 |
| P0-TYPE | `npm run typecheck` | PASS | Exit 0 | Phase 0 |
| P0-UNIT | `npm test` | PASS | 26 files; 115 tests | Phase 0 |
| P0-BUILD | `npm run build` | PASS | 41 routes/pages generated | Phase 0 |
| P0-E2E | `npm run test:e2e` | PASS | 42/42 desktop/mobile | Phase 0 mandatory regression |
| C1-INTEGRATION | `npm run test:database` | PASS | Disposable Supabase invariant fixture; transaction rolls back synthetic rows | Chunk 1 |

Offline `npm ci` printed 498 packages and zero audited vulnerabilities, but its wrapper received an interrupt immediately after completion; `npm ls --depth=0` then exited 0. Each required baseline ran independently and passed.

## Test-harness inventory

| Harness ID | Procedure | First due | Status | Evidence/gap owner |
| --- | --- | --- | --- | --- |
| H-001 | Vitest unit suite | Phase 0 | AVAILABLE | `npm test`; engineering |
| H-002 | ESLint | Phase 0 | AVAILABLE | `npm run lint`; engineering |
| H-003 | TypeScript strict check | Phase 0 | AVAILABLE | `npm run typecheck`; engineering |
| H-004 | Production Next build | Phase 0 | AVAILABLE | `npm run build`; engineering |
| H-005 | Playwright desktop/mobile | Phase 0 | AVAILABLE | `npm run test:e2e`; engineering |
| H-006 | Supabase integration suite | Chunk 1 | AVAILABLE | `npm run test:database`; engineering |
| H-007 | Migration up/rollback rehearsal | Chunk 1 | AVAILABLE | `supabase db reset`, `npm run test:rollback`; database owner |
| H-008 | Generated DB-type drift check | Chunk 1 | AVAILABLE | `npm run types:database:check`; engineering |
| H-009 | Transaction barriers/failure injection | Chunk 1 | AVAILABLE | optimistic conflict, uniqueness, lease, rollback fixtures; engineering |
| H-010 | Format check | Chunk 1 | AVAILABLE | `git diff --check`; engineering |
| H-011 | Axe accessibility | Chunk 2 | AVAILABLE | Playwright axe; design/engineering |
| H-012 | Deterministic visual regression/artifacts | Chunk 2 | AVAILABLE | Playwright captures for every step at 1440 and 390 pixels plus mobile error state; design/engineering |
| H-013 | Fake clock/timezone/DST | Chunk 3 | MISSING_REPOSITORY_HARNESS | Engineering |
| H-014 | Recorded permitted job fixtures | Chunk 3 | PARTIAL | Authorization fixtures due; search owner |
| H-015 | Signed synthetic Stripe webhook fixtures | Chunk 4 | PARTIAL | Full lifecycle due; payments owner |
| H-016 | Local email capture | Chunk 4 | MISSING_REPOSITORY_HARNESS | Engineering |
| H-017 | Separate browser contexts | Chunk 4 | AVAILABLE | Playwright; security owner |
| H-018 | Structural DOCX inspection | Chunk 5 | PARTIAL | Exact artifact assertions due |
| H-019 | Rendered DOCX/Arial verification | Chunk 5 | MISSING_EXTERNAL_DEPENDENCY | Approved renderer/font environment |
| H-020 | PDF extraction comparison | Chunk 5 | MISSING_REPOSITORY_HARNESS | Document owner |
| H-021 | Built-route crawl/link/assets | Chunk 6 | AVAILABLE | Next build/Playwright |
| H-022 | Static/security/dependency scan | Chunk 7 | PARTIAL | Full release scan policy due |
| H-023 | Secret scan | Chunk 7 | MISSING_REPOSITORY_HARNESS | Security owner |
| H-024 | Synthetic PII leak fixtures | Chunk 1 | AVAILABLE | deterministic local/non-model isolation suite; security owner |

`PARTIAL` here describes future-chunk capability, not a Phase 0 required-check result. No harness first due in Phase 0 is missing.

## External credentials and settings unavailable

No secret values were read or recorded. Unavailable/unverified settings include production Supabase admin credentials, Stripe secret/webhook/price/tax configuration, Resend credentials and verified domain, KMS/encryption, production malware scanner, parser/OCR services, storage signing/callback allowlists, scheduler/lease proof, staff roles, approved Arial rendering, monitoring/alerts, analytics/consent, approved retention/legal versions, capacity/staffing values, and documentary authorization for automated job sources. See `docs/CONFIG_DECISIONS.md`.

## Phase 0 evidence

The canonical `evidence/chunk-0/manifest.json` is 7611 bytes with SHA-256 `3190e84ac83b61f5d824c59387333603bf87087d5996553a5aaf43184c8f61b9`. It records 9 applicable Phase 0 checks and 9 passes against documentation commit `0dc823cf95cf75cc95400250cef91da99debf2f2` (with the unchanged-runtime E2E baseline explicitly tied to base commit `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8`). The final Phase 0 commit is evidence-only relative to the tested documentation commit.

## Phase ledger

| Phase/chunk | State | Notes |
| --- | --- | --- |
| Phase 0 | COMPLETE after commit | Documentation, precedence, baselines, and evidence only |
| Chunk 1 | COMPLETE after evidence commit | Additive secure foundation; production gates remain disabled |
| Chunk 2 | COMPLETE after evidence commit | Anonymous four-step intake, secure finalization, pending feasibility handoff, admin visibility, accessibility, and responsive evidence |
| Chunks 3-7 | NOT AUTHORIZED / PENDING | Boundaries indexed; no work performed |
## Chunk 1 implementation: secure typed foundation

### Entity relationship summary

```text
anonymous draft --< document versions --< candidate facts --< conflicts
       |                    |                    |
       |                    +-- local quarantine/isolation provenance
       +--< immutable intake snapshots --< feasibility plans/assessments --< immutable quotes
                                      |                         |
                                      +--< match evaluations    +-- capacity allocation/audit

quote + held capacity + durable provider command -> checkout attempt -> payment attempt
payment attempt -> refund operations -> derived refund aggregate
paid search order -> original/active criteria snapshots -> amendments -> job snapshots/evaluations
paid search order -> material purchase -> lines -> immutable line revisions -> artifacts/file versions
material line + (delivered order, delivered match) -> entitlement history -> one current claim
reference record -> encrypted versions -> exact-job permissions -> access audit/revocation
all deliverable effects -> atomic releases + transactional outbox + scheduled leases + audit events
```

Migration `202609040022_corrected_chunk1_foundation.sql` is additive. It creates corrected `ap_*` records beside the legacy schema, default-deny RLS, private service-role capability RPCs, compatibility/backfill records, state guards, revision invalidation procedures, configuration gates, and job leases. `src/lib/database.types.ts` is generated from the migrated schema.

### Orthogonal state dimensions

| Dimension | Source of truth | Values/derivation |
| --- | --- | --- |
| Draft | `ap_anonymous_drafts.state` | in progress, complete, locked to Checkout, converted, expired |
| Source processing | `ap_document_versions.processing_state` | uploaded, quarantined, scanning, extracting, ready, failed, superseded |
| Feasibility | assessment state/outcome/blocker | run state separated from likely/limited/infeasible and candidate/human blocker |
| Capacity | allocation lifecycle + debit | none/reserved/consumed/completed/superseded/released/expired separated from none/held/spent/returned |
| Checkout | `ap_checkout_attempts.state` | none, open, canceled, expired, completed, failed |
| Payment | settlement + dispute | unpaid/processing/paid/failed independent of none/open/won/lost |
| Refund | operations plus aggregate view | scoped pending/succeeded/failed operations; derived none/pending/partial/full/failed |
| Search | fulfillment + adjustment | fulfillment independent of proposed/accepted/declined/expired adjustment; delayed is projected only |
| Material | readiness + fulfillment + substitution | three guarded concerns, never one catch-all field |
| Communication | outbox state | queued, sending, sent, retry, dead letter |
| Customer portal | `projectCustomerState` | derived precedence only; no editable aggregate-state column |

### Transition ownership and invariants

- Anonymous routes own draft capability creation/read/save and private versioned upload registration. The opaque UUID never authorizes; the separate 256-bit secret is sent only in an HttpOnly SameSite cookie and only its SHA-256 is stored. Optimistic versions return a recoverable `409` conflict.
- Checkout orchestration owns draft lock/cancel return. Open Checkout requires an approved tax-inclusive configuration plus the same subject's unexpired immutable quote and held capacity. No public UI was changed in Chunk 1.
- The secure file worker owns `QUARANTINED -> MALWARE_SCAN -> SANDBOXED_PARSE -> REFERENCE_ISOLATION -> LEAK_SCAN -> MODEL_READY`. Missing configuration, scanner uncertainty, empty/scanned-only text, reference uncertainty, or leak detection produces no model input. Superseded uploads ignore late results.
- Snapshot/revision procedures own invalidation. Pre-activation edits invalidate the prior feasibility, quote, review, evaluation, and never-consumed capacity. After activation, an accepted child revision preserves the winning quote, payment, order, original snapshot, and historical deadline while invalidating only prior revision work. Paid material corrections supersede only that line revision's files/approvals/capacity.
- Capacity availability is `total - held - spent`; earliest ending bucket then UUID is the deterministic tie rule. Spent capacity can become completed/superseded but never returned. Multi-line reservations validate attributable member-unit totals atomically.
- Payment settlement never becomes “refunded.” Refund operations use integer cents, payment/optional-line scope, idempotency, and a derived aggregate. Dispute WON requires resolution plus secured/restored funds; LOST requires a distinct funds-reversed time.
- Materials use immutable entitlement history plus one atomic current claim keyed by `(delivered_order_id, delivered_match_id)`. A successful full line refund and terminal history are required before release; pending, disputed, partial, or delivered claims remain locked.
- Provider events, authenticated-envelope sensitive payloads, snapshots, entitlement history, capacity audit, general audit, and reference-access history are immutable. Quote commercial content is immutable; only one-way invalidation metadata can change. Sensitive payloads store AES-256-GCM ciphertext, nonce, tag, wrapped data key, exact KMS identity/version, and context hash; processing fails closed until the approved KMS adapter is configured.
- General snapshots and public draft responses exclude provider IDs, storage paths, extracted resume text, sensitive wording, and reference PII. Sensitive wording is referenced through encrypted immutable payload IDs/hashes. References use opaque client IDs, encrypted version records, exact-job permission snapshots, contact-change reconfirmation, revocation, purpose-based access, and separate reference-sheet artifacts.
- `CUSTOMER_SUPPLIED_INGESTION` is false by default and database-guarded by an approval reference. No public intake or price exists.
- Retention records and cleanup leases exist, but the corrected cleanup gate remains false until owner-approved draft/file durations and matching Privacy Policy approval are stored. No new duration was invented.

### Retention and deletion configuration matrix

This is a required configuration matrix, not a retention approval. Every duration, lawful/business purpose, backup rule, and legal approval remains `UNSET_BLOCKING`; therefore corrected cleanup cannot run and production release remains blocked. Execution order is always revoke capabilities/downloads first, then delete or crypto-shred sensitive data, then retain only an approved non-linkable tombstone if required.

| Entity/domain | Fields eligible to remain | Duration | Purpose/legal basis | Primary deletion mechanism | Backup behavior | Accountable owner / approval |
| --- | --- | --- | --- | --- | --- | --- |
| Anonymous draft/session | Opaque non-linkable tombstone only after deletion | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Revoke/rotate capability; delete answers, email linkage, linkable hashes, and session records | `UNSET_BLOCKING`; restore must reapply deletion | Privacy/platform / legal `UNSET_BLOCKING` |
| Raw source uploads | No document bytes, extracted text, filename, path, or linkable content hash after deletion | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Revoke access; delete private objects and metadata; destroy any keyed linkability material | `UNSET_BLOCKING`; object/PITR propagation required | Security/privacy / legal `UNSET_BLOCKING` |
| Extracted candidate facts | Non-PII aggregate tombstone only if approved | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Delete typed PII/facts, conflicts, locators, and unkeyed PII-derived hashes; preserve no claim text | `UNSET_BLOCKING`; restore must reapply deletion | Privacy/product / legal `UNSET_BLOCKING` |
| Sensitive free-text payloads | Opaque non-linkable tombstone only | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Revoke access and crypto-shred wrapped data key, then delete ciphertext/context hashes as approved | `UNSET_BLOCKING`; wrapped keys must not be recoverable after final erasure | Security/privacy / legal `UNSET_BLOCKING` |
| Job and customer/order snapshots | Public job evidence may remain only under approved source rules; customer-linked criteria/facts may not | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Unlink/delete customer PII and linkable hashes; retain only approved operational tombstone | `UNSET_BLOCKING`; restore must reapply unlink/deletion | Product/privacy / legal `UNSET_BLOCKING` |
| Payment/refund records | Minimum approved financial/legal fields only; no resume, reference, or custom wording | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Remove customer PII not legally required; retain minimal provider/accounting evidence under legal hold rules | `UNSET_BLOCKING`; finance/legal restore controls required | Finance/privacy / legal `UNSET_BLOCKING` |
| Generated artifacts/files | No generated document bytes, storage path, embedded PII, or linkable content hash after deletion | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Revoke downloads first; delete private files and PII-bearing metadata; tombstone release without identity | `UNSET_BLOCKING`; storage/PITR propagation required | Document/privacy / legal `UNSET_BLOCKING` |
| Reference records/permissions | Non-PII permission/revocation tombstone only if approved | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Revoke exact-job permissions/downloads; crypto-shred contact payload and delete linkable hashes/identity | `UNSET_BLOCKING`; no recoverable contact after final erasure | Privacy/operations / legal `UNSET_BLOCKING` |
| Authentication records/linkages | Non-linkable security event only if approved | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Revoke links/tokens/sessions, remove email/account linkage, and delete auth PII | `UNSET_BLOCKING`; restored auth state must remain revoked | Security/platform / legal `UNSET_BLOCKING` |
| Analytics | Only approved coarse allowlisted events with no PII/free text | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Delete pseudonymous linkage and disallowed payloads; honor consent/deletion propagation | `UNSET_BLOCKING`; provider deletion proof required | Privacy/product / legal `UNSET_BLOCKING` |
| Audit/operational history | Opaque non-linkable event type, time, and approved non-PII reason only | `UNSET_BLOCKING` | `UNSET_BLOCKING` | Replace customer/entity linkage and PII with irreversible non-linkable tombstone; never retain names/text | `UNSET_BLOCKING`; restored copies must repeat tombstoning | Security/legal / legal `UNSET_BLOCKING` |
### Migration, compatibility, and rollback

The executed sequence is expand -> regenerate types -> compatibility reads/writes -> idempotent checkpointed legacy backfill -> invariant validation -> later authorized cutover. Checkpoint `202609040022 / LEGACY_ORDERS_V1` maps legacy payments/orders without modifying them; `ap_legacy_order_compatibility` preserves reads. New corrected records do not require deprecated fields. The disposable migration and invariant fixture preserve legacy tables and roll back all synthetic data.

Normal rollback reverts code/traffic and leaves the additive schema. The compensating script is guarded, unactivated-only, refuses operational corrected data, and was rehearsed in a disposable database; it preserves the legacy schema. Exact commands, queries, owners, recovery, and blockers are in `docs/DEPLOYMENT_RUNBOOK.md`.

### Chunk 1 verification inventory

| Check ID | Procedure | Intended result |
| --- | --- | --- |
| C1-MIGRATE | `supabase db reset` | All 22 migrations apply from zero |
| C1-DB | `npm run test:database` | Synthetic transaction verifies draft/auth/version/file/RLS/snapshot/capacity/payment/refund/entitlement/flag/lease invariants |
| C1-LEGACY | `npm run test:legacy-backfill` | Pre-Chunk-1 paid order/payment survive migration, compatibility backfill, checkpoint, and idempotent rerun |
| C1-ROLLBACK | `npm run test:rollback` | Guarded rollback succeeds in disposable empty state and legacy `orders` remains |
| C1-TYPES | `npm run types:database:check` | Generated schema types match |
| C1-UNIT | `npm test` | Typed unions, provenance, canonicalization, pipeline, upload, and all regression units pass |
| C1-INTEGRATION-EXTERNAL | `npm run test:integration` | Real scanner tests are local N/A without approved scanner; deterministic fail-closed tests are mandatory |
| C1-LINT/TYPE/BUILD/E2E | standard repository commands | Relevant regression suite passes |
| C1-FORMAT | `git diff --check` | No whitespace errors |

Production credentials were not used. The unconfigured production malware scanner/parser/model boundary and actual retention/privacy approvals remain explicit release blockers, permitted by Chunk 1 only because the repository has deterministic local contract fixtures and the affected features fail closed.

### Chunk 1 verified result

Tested code commit `cd267dc8bbfad07107b22f88c06e26cbdbbaed34` (tree `a029a26c3b33235bc34f8d54048549cc353611f1`) passed all 11 applicable Chunk 1 checks: zero-to-latest migration, database invariants, legacy paid-order backfill/idempotency, guarded rollback, generated-type equality, lint, TypeScript, 135/135 repository tests in 32 files, production build with 43 generated pages, 42/42 desktop/mobile Playwright cases, and staged whitespace validation. The real-scanner integration suite reported 3/3 tests skipped across two files because no approved production scanner was configured; this is `NOT_APPLICABLE_LOCAL`, is excluded from the denominator, and does not weaken the mandatory deterministic fail-closed tests.

The cumulative verified ledger through Chunk 1 is 20/20 applicable checks: 9/9 from Phase 0 and 11/11 from Chunk 1. Failed tests: none. Blocked applicable tests: none. Chunk 2 results are recorded below.


## Chunk 2 implementation: anonymous four-step intake

### Flow and data relationship summary

```text
anonymous capability cookie -> four-step draft + optimistic version
                                  |
                                  +-- private resume/optional-cover versions
                                  +-- presented candidate-fact decisions
                                  +-- structured customer assertions/experience
                                  +-- typed criteria and policy choices
                                  +-- encrypted sensitive wording reference
                                  |
                                  +-- atomic finalization
                                           |
                                           +-- immutable intake snapshot + content hash
                                           +-- immutable fact review history
                                           +-- typed experience/capability facts
                                           +-- PENDING feasibility request

protected staff role -> pending-intake summary (not a feasibility result, quote, reservation, or payment)
```

The active public route renders `wizard-v3.tsx` without a prepayment authentication gate. Exactly four numbered steps are stored (`0` through `3`): basics and private documents; work direction; candidate-fact review and experience; preferences, pay, exclusions, review, and the single combined Terms/Privacy agreement. Adaptive sections do not become additional steps. Back, refresh, same-session return, payment-cancel return, progressive saves, and recoverable optimistic-version conflicts use the server draft and capability cookie; document bytes and draft answers are never placed in browser local storage.

### Transition ownership and invariants

- The anonymous draft route owns typed partial saves and current-step progression. Every read/write requires the separate capability secret; the draft ID is insufficient. Visible-step validation permits partial autosave and blocks forward navigation or finalization until the current step is valid.
- The document route owns PDF/DOCX server validation, private version registration, replacement/supersession, removal, and explicit retry. Upload status is visible and errors remain actionable. Finalization requires a non-failed resume record but never exposes storage paths or extracted text.
- Fact-presentation records prove which fact/version was shown. `CONFIRMED`, `REJECTED`, `CORRECTED`, and skipped decisions create immutable review history. Resume or cover-letter text inspection remains unconfirmed evidence; only customer confirmation or independently substantiated human evidence may satisfy a claim or hard gate.
- Structured experience records retain actual identity, dates/precision, responsibilities, tools, scope, outcome, intensity, and conditional education detail. Caregiving and other relevant life context remain optional context and receive no occupational credit.
- Atomic finalization owns immutable normalized access email, a canonical content hash, one protected encrypted sensitive-payload reference, fact transitions, customer-asserted facts, experience identities, and a real `PENDING` feasibility request. It does not create Checkout, payment, quote, capacity, or a feasibility outcome.
- A newer pre-activation snapshot stales the superseded feasibility request and invalidates only the superseded snapshot's assessment, quote, evaluations, review, and never-consumed reserved capacity. Winning post-activation commercial records remain governed by Chunk 1 revision procedures.
- The production encryption adapter is a fail-closed remote KMS boundary. It requires exact HTTPS wrap/unwrap endpoints, bearer authorization, key identity/version agreement, timeout handling, and successful authenticated wrapping. Missing configuration disables finalization; no production mock path exists.
- Aggregate intake analytics accept only an allowlisted event name and numbered step. Names, email, free text, document metadata, draft IDs, capability values, and arbitrary dimensions are not accepted.
- The staff pending-intake surface is protected by existing admin authorization and labels pending records accurately. No public customer-supplied-job product, pricing, matching, Checkout, or site-wide redesign was added.

### Accessibility, responsive behavior, and recovery

The wizard uses native checkbox/radio controls, labelled fields and fieldsets, a linked focusable error summary, adjacent errors for grouped/required controls, polite save/status announcements, first-invalid focus, visible keyboard focus, minimum 44-pixel targets, reduced-motion behavior, forced-color support, and responsive layouts from 320 through 1440 pixels. Automated browser coverage includes keyboard-only progression, 200% zoom, reduced motion, forced colors, every step at desktop/mobile sizes, adaptive task follow-ups, and a mobile validation-error capture. The app image-viewer ACL fault prevented a separate manual in-app image inspection; the committed screenshots and automated layout assertions are the retained visual evidence.

### Migration, compatibility, and rollback

Additive migration `202609040023_chunk2_four_step_intake.sql` follows the Chunk 1 foundation. It adds four-step draft metadata, candidate-fact presentation tier fields, immutable presentation/review history, targeted questions, pending feasibility requests, privacy-safe aggregate counts, and capability-only read/save/retry/finalization functions. Existing and paid legacy records are not rewritten or dropped. Generated database types include the expanded schema.

Deployment order remains expand -> regenerate types -> compatibility deploy -> checkpoint/validate -> later authorized cutover. Code rollback restores the prior route while leaving the additive compatible schema. No destructive down migration is supplied for operational Chunk 2 data; any compensating migration requires separate database-owner proof and approval. Production activation remains fail closed until KMS, file processing, retention/privacy, capacity/staffing, source authorization, and later-chunk gates are approved.

### Chunk 2 verification inventory

| Check ID | Procedure | Intended result |
| --- | --- | --- |
| C2-MIGRATE | `supabase db reset` | All 23 migrations apply from zero |
| C2-DB | `npm run test:database` | Chunk 1 invariants plus four-step capability, fact decision, invalidation, and pending-feasibility transaction pass |
| C2-LEGACY | `npm run test:legacy-backfill` | Legacy paid records and idempotent compatibility backfill remain intact |
| C2-ROLLBACK | `npm run test:rollback` followed by reset | Guarded Chunk 1 rollback rehearsal still passes and latest schema is restored |
| C2-TYPES | `npm run types:database:check` | Generated schema types match |
| C2-LINT | `npm run lint` | Static lint passes |
| C2-TYPE | `npm run typecheck` | Strict TypeScript passes |
| C2-UNIT | `npm test` | Four-step validation, duration/fact regressions, KMS fail-closed behavior, and repository units pass |
| C2-BUILD | `npm run build` | Production build and route generation pass |
| C2-E2E | `npm run test:e2e` | Full desktop/mobile regression, four-step flow, keyboard, zoom, and media preferences pass |
| C2-A11Y-VISUAL | `tests/e2e/chunk2-evidence.spec.ts` plus committed PNGs | Axe/layout assertions and deterministic step/adaptive/error captures pass |
| C2-INTEGRATION-EXTERNAL | `npm run test:integration` | Real scanner tests are local N/A without an approved scanner; fail-closed deterministic tests remain mandatory |
| C2-FORMAT | `git diff --check` and staged check | No whitespace errors |

### Chunk 2 verified result

The exact candidate commit and final counts are recorded in `evidence/chunk-2/manifest.json` by the evidence-only commit after all checks run. Production credentials were not used. Missing production KMS, malware/parser/model pipeline, approved retention durations and Privacy Policy language, capacity/staffing configuration, documentary source authorization, and later Chunks 3-7 remain release blockers; they are not failed local repository tests.
