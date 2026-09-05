# ApplyPack document generation

## Boundary

Approved, schema-validated customer and job data is the only input to a renderer.

Approved facts and approved job matches -> validated document-content model -> renderer -> private artifact -> human review -> release.

The renderer never chooses job eligibility, invents a qualification, resolves an unknown, changes an approval, or adds unsupported resume claims.

## Output responsibilities

| Artifact | Source of truth | Customer format |
| --- | --- | --- |
| Tailored resume | Existing DOCX renderer and approved Word document | Editable DOCX; any PDF is exported from the approved Word file with the identical base name |
| Tailored cover letter | Existing DOCX renderer and approved Word document | Editable DOCX; any PDF is exported from the approved Word file with the identical base name |
| Ten-job match packet | pdfcn-style repository components rendered by Takumi | Searchable, selectable, tagged PDF |
| Future non-editable reports | Shared DocumentRenderer boundary after separate approval | Renderer selected per artifact |

The pdfcn pilot does not create resume or cover-letter PDFs and does not replace `src/lib/documents/generate.ts`. The locked one-page, single-column, Arial, editable Word requirements remain controlling for those documents. No Arial font was downloaded or committed. The match packet uses Takumi's built-in sans-serif because it is a different, non-editable report; this does not authorize a font substitution in a resume or cover letter.

## Content contract

`JobMatchPacketContent` is defined in `src/lib/documents/job-match-packet/schema.ts`. Final generation fails closed unless the snapshot has:

- schema version `applypack.job-match-packet.v1`;
- the order and customer identities;
- a versioned policy map and approved disclosure text;
- exactly ten distinct jobs;
- an `APPROVED` human-review record for every job;
- `ELIGIBLE` or `ELIGIBLE_WITH_ALLOWED_UNKNOWNS`;
- a hard-gate result of `PASS`;
- a valid HTTPS direct application URL;
- evidence IDs for every connection, gap, compromise, and unknown warning.

Every rendered claim has a deterministic packet claim ID plus typed source references. Candidate references resolve to a current `CUSTOMER_CONFIRMED` or `HUMAN_VERIFIED` `ap_candidate_facts` row owned by the order customer and, when snapshot-bound, the order intake's latest snapshot. Job references resolve to an allowlisted field on the exact selected job. Strong connections require both a candidate fact and job evidence; dangling, cross-customer, rejected, superseded, wrong-job, and untyped references fail staging or correction.

A shared database gate verifies material unknown-warning completeness during both initial staging and an approved correction. Schedule and timezone are evaluated independently so one literal unknown cannot mask a known alternative.

Control characters and bidirectional override controls are removed, Unicode is normalized, lengths are bounded, unknown object keys are rejected, and JSX renders values as inert text. Customer or job-posting strings cannot select components, execute markup, load resources, or change policy.

## pdfcn and Takumi implementation

The upstream pdfcn repository was audited at commit `590a1f9421a7561ed94bc3dec5eae46360b28c69`. ApplyPack vendors only a local, attributed component layer in `src/lib/documents/pdfcn` rather than installing a fictional `pdfcn` engine or copying the documentation application.

Local components: ThemeProvider, Text, Heading, Section, Stack, List, Link, Divider, KeepTogether, PageBreak, PageHeader, PageFooter, and PageNumber. Component provenance revision: `590a1f9421a7561ed94bc3dec5eae46360b28c69:takumi-minimal-audited`.

Pinned direct packages: `takumi-pdf@0.11.0` and development-only `pdfjs-dist@5.4.296`. Takumi resolves `@takumi-rs/helpers@2.10.0` transitively; ApplyPack does not declare it directly.

Takumi was selected because pdfcn's Takumi registry components provide a server-side React-to-PDF path with vector text, hyperlinks, pagination primitives, metadata, tagged output, and no browser process. Forme was not installed because the pilot needs one renderer and maintaining two engines would duplicate supply-chain, layout, and deployment risk.

The renderer imports `takumi-pdf/next` only when the Next runtime is present and otherwise uses `takumi-pdf` for Node tests. The local pdfcn theme boundary is a pure server component with no React client context. It requires the Node runtime; it is not an Edge route. Takumi packages a native/WASM renderer, so production bundling must preserve the package's runtime assets.

## Packet template and naming

The ApplyPack-specific theme derives from the approved navy, green, violet, yellow, and neutral palette. It uses US Letter pages, restrained repeated headers and footers, page counters, clickable direct links, explicit warning panels, and natural multi-page flow. Heading-plus-first-content groups use KeepTogether; whole job entries do not, so long entries may paginate without clipping or severe blank space.

The deterministic filename is `[Customer_Name]_ApplyPack_Job_Matches.pdf`. Internal schema, template, renderer, and upstream versions remain in metadata and database records.

Resume and cover-letter naming remains `[Customer_Name]_Resume_[Company]_[Position].docx` and `[Customer_Name]_Cover_Letter_[Company]_[Position].docx`. Word-export PDFs use the identical base filename.

## Server-side generation and private storage

The admin route requires the existing operator/admin session, role check, allowlist, and AAL2 MFA. It loads only the order's staged or delivered, human-reviewed job-match records through the service-role repository. The customer route requires an authenticated owner and returns not-found for cross-customer access.

Artifacts use the existing private `customer-deliveries` bucket. The browser receives only a 60-second signed URL. No permanent public URL is created. The immutable content identity hashes canonical content plus schema, template, renderer, pdfcn, and Takumi versions. A monotonically increasing order content revision and unique `(order_id, content_identity, content_revision)` key prevent an earlier preview from being approved after a correction. A five-minute recoverable render lease and per-attempt `render_generation` token make retries idempotent and prevent a stale worker from committing. If object upload succeeds but the database update is interrupted, the retry accepts the existing private object only after its SHA-256 equals the new render; mismatches fail closed, and an older worker never deletes a newer worker's object.

Failed renders are marked `FAILED`, record only a bounded failure code, and never become deliverable. A storage object left by a process interruption is recoverable only through the checksum-verified path above. Customer content is excluded from audit events, logs, and analytics; conflict audits retain opaque job IDs, revision numbers, and the reapproval requirement, not packet statements. Generation fails closed unless `APP_GENERATED_ARTIFACT_RETENTION_DAYS` supplies an approved duration. Maintenance first marks a due artifact `EXPIRED`, atomically clears the order's current pointer, then removes its private object; a failed object deletion is queued without restoring access.

## Human review

Generation does not change a job's approval state. Search completion stages the ten reviewed records without exposing them to the customer. The admin surface shows those exact records, warnings, identity, checksum, content revision, template version, and renderer version. The operator generates or reuses the current revision, opens the private preview, and approves only the exact preview checksum. In the approval transaction, ApplyPack locks the order, artifact, matches, and jobs; rechecks all ten for active/open status, no rejection, verification within 24 hours, HTTPS direct links, Liveops exclusion, exact membership, and unchanged application URLs; then atomically binds the artifact, releases those ten records, and records the audit event. An approved correction serializes on the same order lock, advances the content revision, clears visibility for all ten matches, supersedes the prior approved artifact, and requires a new preview and human approval. It never mutates an earlier artifact snapshot. Customers can download only the current approved artifact identified by the order pointer.

Fresh customer reauthentication is part of the controlling download policy but the broader Chunk 4 mechanism is not yet implemented. This pilot enforces authentication, ownership, current-artifact approval, and a 60-second URL; release remains blocked until fresh reauthentication exists and is proven.

## Local development and QA

Run `npm ci --ignore-scripts`, `npm run test:pdfcn:visual`, `npm test`, `npm run test:integration`, `npm run test:database`, `npm run types:database:check`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, and `git diff --check`.

Set `APPLYPACK_PDFCN_VISUAL_DIR` outside the repository. Render PDFs to page images with local Poppler `pdftoppm` and inspect every page for clipping, overlap, orphaned headings, blank pages, wrapping, warnings, links, page numbers, spacing, colors, and contrast. Never commit render output, private artifacts, caches, or build output.

## Upgrade and rollback

1. Pin a new pdfcn commit and exact direct Takumi version, then record the resolved helper/runtime transitive versions.
2. Review component diffs, licenses, scripts, network behavior, native/WASM changes, and bundling notes.
3. Port only used components; preserve notices.
4. Increment renderer/template versions.
5. Repeat database, parser, rendering, visual, build, and E2E gates.
6. Obtain independent review.

To roll back, disable generation at the route/release boundary and keep approved artifacts. Revert application code. The guarded SQL rollback refuses to run when artifact rows exist; with no artifacts it drops pilot records and restores the exact preceding delivery function. Prefer a reviewed forward migration after real artifacts exist.

## Known limitations

- Tagged output is verified, but strict PDF/UA is not claimed: Takumi's `tagged: "ua1"` validation failed on the audited minimal document.
- No Arial font is embedded; resume and cover-letter PDFs remain Word exports.
- Fresh reauthentication, an approved configured retention duration, production migration, hosted cold-start/memory telemetry, and serverless/WASM proof remain release gates.
- This pilot is not completion of the broader Chunk 5 document-automation scope.
- Next 16's successful Turbopack build emits an over-broad file-pattern warning from the official `takumi-pdf/next` WASM loader. Hosted bundle size/cold start must be measured before release; do not silence the warning by hiding or mocking the renderer.
