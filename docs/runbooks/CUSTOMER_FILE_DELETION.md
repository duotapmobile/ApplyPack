# Customer file deletion

## Scope

Covers deletion or expiry of uploaded résumés, prior cover letters, generated files, render previews, references, temporary work files, and derived private payloads.

## Prerequisites

- Authenticated customer or authorized privacy operator.
- Current retention/legal-hold policy version.
- Inventory of database rows, private-storage objects, superseded versions, previews, and temporary artifacts.

## Procedure

1. Verify tenant ownership and legal-hold status. Never accept a storage path from the client as authority.
2. Revoke download capabilities and active processing leases.
3. Delete private objects through server-owned identifiers, then remove or tombstone dependent records in the governed order.
4. Clear renderer/parser temporary files and scheduled cleanup retries. Keep only the minimum non-content audit evidence required by approved retention policy.
5. Verify generated correction values and document text were not copied into operational audit logs.

## Verification

Record request/authority ID, policy version, opaque object counts, deletion result, retry/dead-letter state, and a post-delete tenant-scoped lookup. Never record filenames, document text, email addresses, or secrets in evidence.

## Failure and recovery

Keep access revoked, queue idempotent cleanup, alert privacy/security owners, and verify every storage/database boundary before closing the request.

## Stop conditions

Stop for ownership ambiguity, legal hold, unknown retention authority, cross-tenant result, undeletable object without escalation, or any proposal to log private content.
