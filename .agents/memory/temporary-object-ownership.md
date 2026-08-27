---
name: Temporary object ownership
description: Lifecycle rule for temporary App Storage objects that are referenced by database workflows.
---

Reserve each temporary object path durably before uploading it. Treat upload reservation, workflow ownership, and cleanup eligibility as distinct states; transfer ownership or queue deletion in the same transaction that changes the owning workflow row. Cleanup workers must never delete active reservations.

**Why:** Upload, database, and deletion operations cannot share one transaction. Without an explicit ownership state, crashes and partial failures either leak untracked objects or delete a valid object before its database row claims it. Selecting a queued object before deletion is not enough: ownership can change between the check and the external delete.

**How to apply:** New temporary-file workflows should use a durable reservation/outbox, make explicit cleanup requests retryable, and serialize ownership transfer with the final ownership recheck and external deletion using the same per-object lock. Recovery should use a grace period, run both at startup and periodically, exclude owned paths, and condition stale worker outcomes on the exact active attempt. Reject superseded results at the API boundary too; silently discarding their database writes is insufficient.