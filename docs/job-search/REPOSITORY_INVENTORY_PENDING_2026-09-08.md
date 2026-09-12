# Pending master repository inventory reconciliation — 2026-09-08

The inspected master is `C:\Users\mskir\Desktop\Repos\listofvariousrepos.md`. Workspace governance makes that location read-only, so it was **not updated**. This file is a pending entry and reconciliation record, not a second master.

## Camofox Browser

- Repository: `https://github.com/jo-inc/camofox-browser`
- Inspected default branch commit: `e5a36f5cd0332fde6597de474329a308a53a0716`
- Inspection date: 2026-09-08
- Inventory status: `REFERENCE_ONLY`
- ApplyPack decision: `REJECT_FOR_APPLYPACK`
- Installation: prohibited
- Runtime integration: prohibited
- Deployment: prohibited
- Use against blocked sources: prohibited

The source documentation describes an agent-oriented Camoufox server with anti-detection/fingerprint-spoofing positioning, proxy/session features, structured extraction, accessibility snapshots, element references, tracing, and APIs. The rejection follows ApplyPack's permission-aware HTTP-first policy and does not depend on validating every marketing, performance, package-size, telemetry, version, or feature claim. Nothing was installed and no repository script was executed.

Reference patterns that may be independently reimplemented only for a justified requirement: compact accessibility snapshots, stable element references, extraction schemas, request IDs, structured logs, session isolation/tracing, download limits, cookie-field allowlists, and path-traversal defenses. This decision does not authorize a browser worker.

## Existing master reconciliation

| Name | Exact identity in inspected records | Reconciliation |
| --- | --- | --- |
| CareerOps | Master says `santifer/career-ops`; repository audit resolves current identity to `career-ops-hq/career-ops` | Keep reference-only; correct alias and remove unsupported runtime/telemetry assertions when master becomes writable |
| Crawl4AI | `unclecode/crawl4ai` | Existing identity retained; no ApplyPack runtime approval |
| Stagehand | No entry found in the inspected master | Do not guess or add an identity without a separate evidence review |
| Browser Use | No entry found | Same |
| Playwright | Mentioned as a CareerOps capability, not a standalone inventory entry | ApplyPack's existing test dependency is not authorization for source circumvention |
| CloakBrowser | No entry found | Same |
| Scrapling | No entry found | Same |
| Documented ATS access | Not represented as one repository entry | Track access per provider and employer in the source authorization matrix, not as blanket permission |
