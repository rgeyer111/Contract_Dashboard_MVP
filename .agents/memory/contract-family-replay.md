---
name: Contract family replay
description: Rules for grouping agreements, amendments, and renewals into an effective contract.
---

Store every PDF as its own immutable contract record and link amendments or renewals to a root agreement. Resolve the effective contract by replaying family documents in effective-date order, replacing only fields whose document value is present and not marked `not_found`.

**Why:** Amendments are diffs. Treating them as standalone contracts creates mostly-empty rows, while replacing every parent field would incorrectly erase untouched obligations. Signature order is unreliable because amendments can be signed after they take effect.

**How to apply:** Keep original per-document provenance, expose old and current values with their source filenames, and use the replayed effective record for register values, deadlines, and alerts.