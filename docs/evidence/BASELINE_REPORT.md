# ApplyPack Baseline Report

Date: September 1, 2026

## Repository

- Remote: https://github.com/duotapmobile/ApplyPack.git
- Initial branch: main
- Initial state: empty repository with no commits
- Implementation branch: codex/applypack-production

## Runtime

- Node.js: 22.22.0
- npm: 10.9.4
- Scaffold: Next.js 16.3.4, React 19.2.8, TypeScript, App Router

## Untouched scaffold checks

- npm run lint: passed
- npm run build: passed
- npm audit after scaffold: zero reported vulnerabilities

## Environment observations

- GitHub CLI was not installed or available.
- Railway CLI was not installed or available.
- A package lock outside the repository caused a Turbopack root warning; repository configuration now pins the Turbopack root to this checkout.
