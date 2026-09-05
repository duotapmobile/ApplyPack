# Third-party notices

## pdfcn component source

Repository: https://github.com/shadcn-labs/pdfcn
Audited commit: `590a1f9421a7561ed94bc3dec5eae46360b28c69`
License: MIT
Copyright: Copyright 2026 Shadcn Labs

ApplyPack adapted only the Takumi component concepts used in `src/lib/documents/pdfcn/components.tsx`. That source retains SPDX, copyright, commit, and adaptation notices. No documentation application, examples, analytics, fonts, audio, or unused components were copied.

## Takumi

Direct package: `takumi-pdf@0.11.0`
Resolved runtime helper: `@takumi-rs/helpers@2.10.0` (transitive; not separately declared by ApplyPack)
Documentation: https://takumi.kane.tw/docs/pdf
Declared license: MIT OR Apache-2.0
Install scripts: none at the selected versions

Takumi supplies the native/WASM renderer. ApplyPack makes no remote font or pdfcn website call.

## pdfjs-dist

Package: `pdfjs-dist@5.4.296`
Use: development-only PDF parsing, extraction, link, metadata, and page assertions
License: Apache-2.0
Install scripts: none at the selected version

## CareerOps audit reference
Transitive optional development packages installed by `pdfjs-dist`:

- `@napi-rs/canvas@0.1.100` (MIT)
- platform binaries at `0.1.100` (MIT; this host selected `@napi-rs/canvas-win32-x64-msvc`)

These packages are development-only, have no `preinstall`, `install`, or `postinstall` lifecycle hook at the selected versions, and are not imported by the production renderer.


Repository: https://github.com/career-ops-hq/career-ops
Audited commit: `719d1a4c64735fec4eb6f5f4b1616db4d181476c`
License: MIT, Copyright 2026 Santiago Fernández de Valderrama
Trademark: the career-ops name and brand are reserved separately.

CareerOps is a benchmark only. No CareerOps code, logo, name, data, executable configuration, dependency, or service is included. Future derived code requires a new provenance entry and its MIT notice.
