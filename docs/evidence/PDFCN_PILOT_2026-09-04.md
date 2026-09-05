# pdfcn job-match packet pilot evidence — September 4-5, 2026

## Repository identity and authority

- Repository: `https://github.com/duotapmobile/ApplyPack.git`
- Isolated worktree: `C:\Users\mskir\Desktop\Apply_Pack\applypack-pdfcn-2026-09-04`
- Branch: `codex/applypack-pdfcn-document-generation-2026-09-04`
- Accepted start commit: `6256250693adefe2762a5f921c81fbfbcc305c75`
- Tested implementation commit: `27462f9d1d384ce64d4a9344de84f8049469c746`
- Tested tree: `28c52a85ab39f4cae2e3cd88aa315a974b7063b5`
- Canonical checkout and protected `site` checkout were inspected before and after implementation and were not modified.
- No merge, production migration, provider change, or deployment was performed.

## Implemented boundary

The pilot adds pdfcn/Takumi as ApplyPack's PDF presentation layer for the reviewed ten-job match packet. Approved stored facts and exact job records are normalized into `JobMatchPacketContent`, validated, identity-hashed with every renderer/template/source version, and passed through the shared `DocumentRenderer` boundary to a server-only Takumi renderer. The renderer formats approved data; it cannot choose eligibility, invent qualifications, resolve unknowns, select the ten jobs, or change approval state.

The existing DOCX resume and cover-letter renderer remains the source of truth. Those customer files remain editable Word documents, and any resume or cover-letter PDF remains a Word export with the identical filename base. No pdfcn resume/cover-letter output or unauthorized Arial file was added.

Final packet generation requires exactly ten distinct, human-reviewed matches; current open/active listings; no rejection or confirmed non-negotiable failure; fresh verification; direct HTTPS links; typed current evidence; and explicit warnings for every material unknown. Staging does not release jobs. Final approval locks and revalidates the order, artifact, matches, jobs, content revision, membership, listing state, freshness, rejection status, Liveops exclusion, and unchanged application URLs before atomically binding the exact checksum and making those ten matches visible.

## Privacy, storage, retry, and operator review

Generation runs only in Node on authenticated server routes. Operator access retains role, allowlist, and AAL2 checks; customer access verifies ownership and returns not-found across tenants. The existing private `customer-deliveries` bucket is used with 60-second signed URLs. No permanent public document URL, customer document logging, analytics payload, runtime pdfcn website call, remote font fetch, or browser renderer is present.

Artifact identity includes order, content snapshot, order content revision, schema, template, renderer, pdfcn revision, and Takumi version. A unique revisioned key, recoverable lease, and per-attempt generation token make retries idempotent and stop stale workers. If object upload succeeds before a database interruption, retry accepts the object only when its SHA-256 matches; a stale worker cannot delete or commit a newer object. Corrections serialize on the order lock, supersede rather than mutate an approved artifact, clear customer visibility, increment the revision, and require a new preview and approval. Failed/expired artifacts remain nondeliverable.

The operator sees the exact rendered job records, explicit warnings, content identity, checksum, revision, template version, and renderer version; can preview, regenerate after an approved correction, and approve/download the exact immutable artifact. Generation itself does not approve a job.

## Upstream provenance, components, and dependencies

- pdfcn repository: `https://github.com/shadcn-labs/pdfcn`, audited at commit `590a1f9421a7561ed94bc3dec5eae46360b28c69` (MIT).
- Local component revision: `590a1f9421a7561ed94bc3dec5eae46360b28c69:takumi-minimal-audited`.
- Vendored attributed components: ThemeProvider, Text, Heading, Section, Stack, List, Link, Divider, KeepTogether, PageBreak, PageHeader, PageFooter, and PageNumber.
- Production dependency: `takumi-pdf@0.11.0`, exact (`MIT OR Apache-2.0`).
- Test/parser dependency: `pdfjs-dist@5.4.296`, exact and development-only (Apache-2.0).
- Resolved transitives inspected: `@takumi-rs/helpers@2.10.0` (`MIT OR Apache-2.0`) and `@napi-rs/canvas@0.1.100` (MIT).
- Forme was not installed. Takumi supplies server-side React layout, vector/searchable text, links, pagination, metadata, and tagged output without Chromium; a second renderer would duplicate supply-chain and pagination risk.
- Package scripts and install hooks were inspected. The clean verification install used `--ignore-scripts`; no pdfcn documentation-site dependencies, analytics, paid provider, Puppeteer, Playwright PDF service, or second engine were added.

## Verification results

All commands ran in the isolated worktree on Windows 11, Node `22.22.0`, npm `10.9.4`, Git `2.50.0.windows.2`, Supabase CLI `2.116.0`, and `America/New_York`.

| Check | Command | Result |
| --- | --- | --- |
| Clean dependency install | `npm ci --ignore-scripts --offline` | PASS; 503 packages installed, audit reported 0 vulnerabilities |
| Focused remediation | `npm test -- --run tests/unit/pdfcn-route-safety.test.ts tests/unit/job-match-packet-schema.test.ts tests/unit/job-match-packet-service.test.ts tests/unit/job-match-packet-storage-recovery.test.ts tests/unit/job-match-packet-renderer.test.ts` | PASS; 5 files, 18/18 tests |
| Fresh schema | `npx supabase db reset --local` | PASS; all 24 migrations through `202609040024` |
| Database contracts | `npm run test:database` | PASS; 3/3 transactional fixtures |
| Rollback | `npm run test:rollback` | PASS; `PDFCN_ROLLBACK_OK` and `ROLLBACK_OK`; full schema reset then passed |
| Legacy compatibility | `npm run test:legacy-backfill` | PASS; pre-pilot data survived, backfill passed twice, latest schema restored |
| Generated DB types | `npm run types:database:check` | PASS after expected regeneration for the new migration |
| TypeScript | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS |
| Unit/component suite | `npm test` | PASS; 39 files, 162/162 tests |
| PDF rendering | `npm run test:pdfcn:visual` | PASS; 1 file, 3/3 fixtures |
| External integration | `npm run test:integration` | NOT_APPLICABLE_LOCAL; 2 files and 3 scanner tests skipped because no approved scanner is configured; processing stays fail closed |
| Production bundle | `npm run build` | PASS; 47 routes; documented Takumi/Turbopack broad WASM file-pattern warning remains |
| Browser suite | `npm run test:e2e` | PASS; 61 passed, 1 intentional duplicate-capture skip, 0 failed, 12.1 minutes |
| Supply chain | `npm audit --json`; `npm audit --omit=dev --json` | PASS; 0 vulnerabilities at every severity in both reports |
| Dependency graph | `npm ls takumi-pdf pdfjs-dist @takumi-rs/helpers @napi-rs/canvas --depth=2` | PASS; exact resolved versions matched the lockfile |
| Full dependency tree | `npm ls --all` | Exit 0; platform-inapplicable optional packages were unmet as expected; Next's optional WASM image packages appeared as extraneous local install state and were not lockfile additions |
| Whitespace/staging | `git diff --check`; `git diff --cached --check` | PASS |
| Secret/artifact review | staged filename and diff pattern audit | PASS; no PDF/image/ZIP/WASM output, customer data, font, environment file, key, cache, build output, or private artifact staged |

No required local test failed. The only local N/A result is the deliberately disabled real-scanner suite, which is outside this document renderer and remains fail closed.

## Rendering and visual QA

The representative fixtures cover short content, long titles/employers/URLs, multiple warnings, absent compensation/benefits, transferable matches, long considerations, malicious markup/instruction-like text, special characters, and maximum expected content. `pdfjs-dist` assertions verify PDF signature/opening, extractable/selectable text, all ten titles/employers, annotations for all direct links, metadata, page numbering, stable logical identity, and absence of lost jobs.

Manual inspection covered all 31 rasterized pages in three full contact sheets. No clipping, overlap, missing warnings/jobs, orphaned headings, horizontal overflow, unexpected blank pages, tiny text, incorrect page numbers, broken wrapping, wrong colors, or unreadable contrast was found.

Artifacts are synthetic, outside Git, and intentionally not committed:

| Fixture | PDF | Pages | Bytes | Render | SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| Short | `C:\Users\mskir\AppData\Local\Temp\applypack-pdfcn-visual-20260905-v8\short.pdf` | 8 | 72,037 | 2,286 ms | `0281dd91753b281227c6f0e9f079a6fa69ce21dbac23428e46e3adc9729e5f24` |
| Long fields and warnings | `C:\Users\mskir\AppData\Local\Temp\applypack-pdfcn-visual-20260905-v8\long-fields-and-warnings.pdf` | 9 | 86,883 | 1,465 ms | `cdfee1e79def9f39b3d6ea64c4c382e20bb066758bcf77b7eafff330bea96f27` |
| Maximum content | `C:\Users\mskir\AppData\Local\Temp\applypack-pdfcn-visual-20260905-v8\maximum-content.pdf` | 14 | 123,663 | 2,440 ms | `066ae706185bc1e8ef93231adb414fe979e647e06080e7db43df5bb3e29a2ded` |

Page images and contact sheets are beside each PDF in `*-pages` directories and `*-contact-sheet.png` files.

## Independent review

A separate skeptical reviewer initially returned `CHANGES_REQUIRED`. Remediation added preview-before-release, exact release-time listing/link validation, serialized correction revisioning, customer/job evidence provenance, content-free audit logs, checksum crash recovery, render-generation guards, governed unknown sentinels, and shared staging/correction warning completeness.

The final independent verdict was `ACCEPTED` with no implementation blocker. The reviewer confirmed repository normalization, the shared unknown-warning helper, staging/correction use, direct DB assertions, typed evidence, atomic approval, retry recovery, rollback, privacy documentation, and the DOCX/PDF split. A narrow theoretical race on non-release-critical display fields was recorded as future hardening, not a scoped blocker; the checksum-reviewed artifact remains immutable and all release-critical live fields plus the exact application URL are transactionally revalidated.

## CareerOps correction addendum

- `ADDENDUM_STATUS`: incorporated as governing audit/correction input; no attached text was treated as a direct runtime instruction.
- `ACTIVE_CHUNK`: document-presentation pilot within the broader Chunk 5 area; Chunk 3 was not begun.
- CareerOps repository: `https://github.com/career-ops-hq/career-ops`
- Audited CareerOps commit: `719d1a4c64735fec4eb6f5f4b1616db4d181476c`
- Disposition: pinned donor benchmark only; no CareerOps package, script, provider, crawl, customer data, or runtime integration.
- Reimplemented now: only applicable fail-closed evidence/golden-test ideas at ApplyPack's existing typed boundary.
- Deferred to separately authorized Chunk 3: source-access policy, provider adapters, liveness/history/receipts, location-safe dedup, and JD-first evidence mapping.
- Rejected: CareerOps agent command center, Playwright/Chromium scanning or PDF generation, broad crawl, mutable executable/parser configuration, holistic score as eligibility, local-file database, and independent resume PDF layout.
- Source correction retained: Himalayas is permission-pending, not approved; Greenhouse/Ashby remain disabled pending rights; Workday CXS and bypass tooling remain rejected.
- Full path-by-path audit, tests, issue/PR findings, source-policy matrix, and seven-repository gap audit are in `docs/research/CAREEROPS_AUDIT_2026-09-04.md`.

## Remaining release blockers and limitations

- Production retention/deletion duration and aligned legal language are not approved; generation fails closed without the environment value.
- Shared fresh customer reauthentication is controlled by later Chunk 4 work; current ownership and 60-second signed-link controls do not clear production release.
- The additive migration and private storage policy have not been applied or proven in production.
- Hosted/serverless Takumi native/WASM cold-start, memory, maximum artifact, and timeout evidence remains required. The local build succeeds, but Turbopack reports an overly broad dynamic WASM file pattern matching 40,994 files.
- Tagged PDF output is enabled and verified structurally; strict PDF/UA conformance has not been independently certified.
- Arial was neither downloaded nor committed. The job packet uses authorized bundled ApplyPack typography; Word-first resume/letter output retains its locked Arial requirement.
- External scanner tests remain local N/A because no approved scanner is configured.
- Forme was not installed, and no experimental resume/cover-letter PDF is customer-visible.
- No production service, payment, authentication, DNS, email, Railway, Vercel, or Supabase provider configuration changed.

Current status: **IMPLEMENTATION AND LOCAL EVIDENCE ACCEPTED; FEATURE BRANCH PUBLICATION AUTHORIZED; MERGE AND PRODUCTION RELEASE NOT AUTHORIZED.**
