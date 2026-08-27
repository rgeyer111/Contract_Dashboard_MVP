---
name: Temporary object ownership
description: Lifecycle rule for temporary App Storage objects that are referenced by database workflows.
---

Reserve each temporary object path durably before uploading it. Treat upload reservation, workflow ownership, and cleanup eligibility as distinct states; transfer ownership or queue deletion in the same transaction that changes the owning workflow row. Cleanup workers must never delete active reservations.

**Why:** Upload, database, and deletion operations cannot share one transaction. Without an explicit ownership state, crashes and partial failures either leak untracked objects or delete a valid object before its database row claims it.

**How to apply:** New temporary-file workflows should use a durable reservation/outbox, make explicit cleanup requests retryable, recover dead-process reservations at startup, and serialize mutations that can replace, retry, complete, or abandon the same workflow.