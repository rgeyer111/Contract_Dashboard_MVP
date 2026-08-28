---
name: Contract deletion serialization
description: Concurrency rule for preserving source PDFs while deleting contract records.
---

Waste copy and verification must run under the same per-contract serialization boundary as the database deletion. A concurrent request should wait, then return not found without copying the source again.

**Why:** Copying before the deletion lock lets simultaneous requests both write and verify the same waste object, obscuring which request owns preservation and making retries harder to reason about.

**How to apply:** Keep future deletion, restore, or replacement flows idempotent around deterministic waste paths, and ensure only the request that still owns the live contract performs preservation and queues original cleanup.