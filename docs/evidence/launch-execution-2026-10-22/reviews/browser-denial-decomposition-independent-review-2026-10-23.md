# Independent browser watcher and denial-test review

Reviewer: `final_adversarial_review`, 2026-10-23. Scope: read-only source and preserved-evidence review. No application changes, browser runs, builds, provider calls or test execution were performed by this reviewer. This report was written only after attempt 03 stopped. **Browser acceptance remains pending; release remains NOT READY.**

## Preserved outcomes

Attempt 01 is an interrupted failure, not acceptance: seven completed passes, two failures, no complete reporter JSON. The reviewer recomputed all 148 artifact hashes with zero mismatches. Receipt `../browser-attempt-01-interrupted.json` SHA-256: `fa34d220babaf670ac8b55eecb617339a2f481dfdf5b9afb59c6a5982ff2bc8b`. Its preserved cover-letter trace contains 11 Fast Refresh rebuild starts and an `Invalid or unexpected token` SyntaxError with no source location. Thus the particular malformed JavaScript source cannot be identified from that trace.

Attempt 02 provides bounded diagnostic proof only: actual `../browser-diagnostic-results.json` reports nine expected passes, zero unexpected/flaky/skipped results. Result SHA-256: `5d542b77d99e4fd7300a01f10ad270bbcd0266825d114c001bdb82049797a02c`; diagnostic receipt SHA-256: `71d6df3cf5f3975a5bfeeccc2799a4dcefa61b7418d51acebaad8ee3a539a885`. It does not establish a complete browser matrix.

Attempt 03 is also an interrupted failure, not acceptance: 30 completed passes, one failure, no complete reporter JSON. The reviewer recomputed all 248 artifact hashes with zero mismatches. Receipt `../browser-attempt-03-interrupted.json` SHA-256: `987b8b46eb328563bea424dc57ec5d4734b2a5370ae9bdaa52a22a2898e392ab`. The retired-board case exhausted its shared 120-second budget during its fifth request; completed status assertions had passed. The trace records six rebuild/done pairs across this multi-route sequence. The large build durations and route request timings are consistent with accumulated development compilation, but are not a production latency measurement or proof that compilation is the sole cause.

## Watcher mechanism and correction limits

The installed Tailwind PostCSS plugin defaults its base to `process.cwd()`, derives an automatic `**/*` source, and converts scanner files/globs into PostCSS dependency messages. The stylesheet uses the unbounded `@import "tailwindcss"`. Installed oxide scanner enumeration independently confirmed attempt 01's live `.trace`, `.network`, trace-resource `.jsonl`, and failure Markdown files under `docs/evidence` in its source list. The final `.log` itself did not appear in that list. Default Next webpack watch ignores `.git`, `.next` and `node_modules`, not the evidence directory. This supports artifact feedback as a mechanism for attempt 01, without proving the exact SyntaxError's origin. The [official Tailwind source-detection documentation](https://tailwindcss.com/docs/detecting-classes-in-source-files#which-files-are-scanned) describes its working-directory scan and gitignore exclusions.

Moving all live outputs to ignored `evidence/launch-browser/<attempt>` removes those files from scanning. The three explicit screenshot writers use `testInfo.outputPath`; CLI `--output` therefore covers their screenshots and Playwright traces. The actual `list,json` reporter selection overrides configured HTML output. JSON and stdout/stderr also belong in the ignored attempt directory, and finalized copies must wait until server teardown.

Ignored scanner files alone would not establish absent watch triggers. The reviewer therefore inspected actual installed `Scanner.globs`, the Tailwind message loop and Next's PostCSS loader. Next converts each `dir-dependency` into `addContextDependency(message.dir)` and ignores its glob suffix. However, Tailwind explicitly skips the root `*` glob when its base equals the plugin base; the observed root and `process.cwd()` are exactly equal. Eighteen remaining named directory bases were observed, none an ancestor of `evidence/launch-browser/attempt-03-full`. Next's separate route watcher filters to route directories and explicit middleware/instrumentation/environment/TypeScript configuration files. No inspected mechanism demonstrates ignored-output feedback for attempt 03, so no CSS source-scanning change is recommended from this evidence. This is a bounded implementation/dependency inspection, not an exhaustive runtime filesystem-event capture.

Next's AGENTS updater writes only if its generated result differs. The known single generated-heading formatting change does not explain recurring writes by itself. The final source receipt must still account for its exact preservation/restoration state.

## Independent assertion mapping

The reviewer retrieved the original complete test source from the failed attempt 03 trace, independently hashing it to `842a21acaf0bc3b4b38a26a9f2b2d4e8baf87738c3803f853f42c2227f9fc1c6`. This is the relevant pre-edit source, not merely the older Git baseline. The revised `tests/e2e/manual-launch-hardening.spec.ts` hashes to `dbc20b2633c0c39f470a594bbbc126dc1330958100e4461e80cd6dbc192a9209`.

| Replacement case | Preserved request and assertions |
| --- | --- |
| Public board | Same `gotoStable(page, "/job-board")`; status 404; nonempty robots directives; every directive contains `noindex`. |
| Subscription checkout | Same POST `/api/checkout/job-board`, `{ data: {} }`; 410 and error containing `not offered`. |
| Board-material checkout | Same POST with the same synthetic UUID and `{ data: {} }`; 410. |
| Two private pages | Same two GET paths and synthetic UUID; each 404. |
| Three customer board APIs | Same three GET paths and synthetic UUID; each 410, `cache-control` containing `no-store`, error containing `not offered`. |
| Billing portal | Same POST with no payload; 410, `no-store`, and exact `No current legacy billing entitlement was found.` body. |

All 13 assertion statements and six request statement templates compare identically in order after trimming indentation; the unchanged loop arrays expand them to 20 assertions over nine requests. The remainder of the file, starting at the public-page reflow loop, is byte-for-byte identical. `playwright.config.ts` remains SHA-256 `77aa303aae1a9599523d5d1e78a72d9fb3b7a8faf9288df21f9cebd082c94682`.

The original test was sequential and contained no shared-state setup, overlapping operation, state/race assertion or mutation-count assertion. Route-source review found immediate retirement responses for subscription, board-material and board APIs; private archive/billing reject unavailable or unauthenticated access before successful archive/provider paths. Isolating these negative checks does not remove a demonstrated shared-state or concurrency proof. It also does not add such proof.

**Timing scope changes:** one aggregate 120-second test becomes nine independent tests, each with the existing configured 120-second ceiling. The possible combined allowance increases; it is not an identical total deadline and must not be called a production latency fix. The matrix grows from 311 to 351 cases because eight additional cases run in each of five projects. Fresh acceptance requires all 351 cases with zero failures, skips and flaky results. `--max-failures=1` may finalize a failing attempt early, but cannot turn its unexecuted cases into acceptance. A separate frozen-production-image timing check can provide scoped local response evidence; hosted performance remains separate.

## Inspected dependency identities

| File | SHA-256 |
| --- | --- |
| `postcss.config.mjs` | `7b299d3d3b16699ddda397c0b2373b3af4f25f8fc9ccc9b3d9e64ef083bc1c21` |
| `src/app/globals.css` | `a0a74b5bbf5ceb4339d7e61850923c8818a7dda6872f2fc79b89f04d84fa72ec` |
| `.gitignore` | `12d758fb34cffe10150e28e0c898d4e35caab4d13c2313d423f50c9c385ce0f3` |
| `next.config.ts` | `7a01ae5858c9621255b5a6157211845eb09762baa755857237410fed488c82ec` |
| `node_modules/@tailwindcss/postcss/dist/index.mjs` | `3cefdbb644619fdcf607e8f4058df63c616e567e34656613f60da72d0ec83057` |
| `node_modules/@tailwindcss/oxide/index.js` | `311f226094e81c0e8d85c6ec02b453b1c0e1239999ae65e78a0d5e02bc005db5` |
| `node_modules/next/dist/build/webpack-config.js` | `395a3b9168eb7552caa489082408a6c0ec056251f62bc4646a6a33433b0c5f4c` |
| `node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js` | `93ec8f2e09635477a933e4ff6c7befebe48bd62909f4a1f83cb8adf6a8dac99e` |
| `node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js` | `bfcdf32d5f14c80903876e2bdef6ea502702eb5a449628f968f2d548671f34f4` |
| `node_modules/next/dist/server/lib/generate-agent-files.js` | `cbadef898783a63df6973f40d6dd6a34e85308d3841825357a0f84aa2a34590a` |

No additional reachable application P0/P1 was established by this bounded diagnosis. These failures are retained, not waived. Current application/image, hosted/provider, human/device and release-owner gates remain subject to the separate final packaging review and actual subsequent acceptance receipts.
