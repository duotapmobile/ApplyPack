# Production observability drill evidence

Do not record credentials, tokens, customer identifiers, document content, provider response bodies, URLs containing secrets, or free-text provider errors. Use stable safe codes and aggregate counts only.

## Record

- Scenario: [RELEASE_MIGRATION_ALIGNMENT | SOURCE_INVENTORY_PROVENANCE | OPERATIONAL_PROCESSING]
- Environment: [staging | production]
- Timestamp UTC:
- Release SHA:
- Operator:
- Operational question:
- Operational impact:

## Existing methods attempted

| Method | Exact bounded action | Result (aggregate/safe code only) | Complete? | Correctness check | Elapsed effort | Exact limitation |
| --- | --- | --- | --- | --- | --- | --- |
| Staging reproduction |  |  |  |  |  |  |
| /api/health |  |  |  |  |  |  |
| Aggregate operations summary |  |  |  |  |  |  |
| Railway deployment/runtime/cron evidence |  |  |  |  |  |  |
| Stripe or targeted Supabase CLI metadata |  |  |  |  |  |  |
| Existing MFA-protected admin control |  |  |  |  |  |  |

## Authority and exposure

- Privileged credential transfer required: [yes | no]
- Raw customer rows required: [yes | no]
- Unsafe free-text log access required: [yes | no]
- Customer-role/RLS behavior tested separately where relevant: [yes | no | not applicable]
- Redaction review passed: [yes | no]

## Staging MCP equivalence

- Equivalent staging question:
- Calls used (maximum two):
- Safe aggregate result:
- Known-evidence correctness check:
- Complete and correct: [yes | no]

## Decision

- Repeated gap code:
- Material effect: [incident closure | release verification | maintenance | convenience only | none]
- Scenario conclusion: [ANSWERED_WITH_EXISTING_TOOLS | UNRESOLVED_SAFE_AGGREGATE_VISIBILITY_GAP]
- Overall decision after all three records: [PRODUCTION_MCP_NOT_JUSTIFIED | PREPARE_EXACT_APPROVAL_PACKET]
- Founder signature/date:
