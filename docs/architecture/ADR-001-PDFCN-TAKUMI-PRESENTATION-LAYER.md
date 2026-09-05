# ADR-001: Use pdfcn and Takumi as ApplyPack's PDF presentation layer

Status: Accepted for the ten-job packet pilot on 2026-09-04. Not deployed.

## Context

ApplyPack needs a professional PDF for the approved ten-job match packet and a reusable boundary for future non-editable reports. Resumes and cover letters remain editable DOCX files whose pagination is approved in Word. A second independent PDF layout would drift.

pdfcn is a component registry, not a drop-in engine. Its repository includes Takumi and Forme examples plus an unrelated documentation application.

## Decision

Use an attributed, minimal repository-owned pdfcn component layer over exactly pinned Takumi packages. Render on the trusted Node server from a strict evidence-grounded model into private storage. Keep the DOCX renderer independent behind `DocumentRenderer<TInput,TOutput>`.

For initial release, store the ten reviewed matches before customer visibility, bind every statement and warning to current typed candidate/job evidence, render an immutable revision, then atomically revalidate eligibility, approve/audit/bind the PDF, and release those exact matches. Corrections serialize on the order, advance its content revision, hide the whole packet, and require a newly reviewed artifact; prior artifacts remain immutable. Hosted generation fails closed until a generated-artifact retention duration is approved and configured.

Rendering uses a bounded lease and a per-attempt generation token. A retry after an upload/database interruption may reuse an existing private object only after checksum equality, so recovery does not create a partial deliverable or allow an older worker to delete or commit a newer worker's output.

Takumi produces searchable vector text, metadata, links, pagination, page counters, and tagged structures without Chromium or a PDF SaaS. Forme is not installed.

## Consequences

The design has one PDF engine, a small audited source surface, deterministic identities, and no browser exposure of customer data. The costs are native/WASM deployment proof, visual QA, and repository ownership of upgrades. Strict PDF/UA is not established.

Provenance is pdfcn commit `590a1f9421a7561ed94bc3dec5eae46360b28c69` and direct `takumi-pdf@0.11.0`; Takumi resolves `@takumi-rs/helpers@2.10.0` transitively. Any version, template, content, or content-revision change produces a separately auditable artifact and repeats review.

## Rejected alternatives

- Forme alongside Takumi: duplicated rendering and maintenance.
- Browser rendering: unnecessary Chromium and larger attack/deployment surface.
- pdfcn resumes or cover letters: violates the Word-first contract.
- Whole pdfcn repository: unused application code, examples, analytics, and dependencies.
- Runtime pdfcn.dev calls or paid providers: privacy and availability mismatch.
