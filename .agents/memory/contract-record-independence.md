---
name: Contract record independence
description: Every uploaded document is managed as its own contract record, without agreement-family replay.
---

Treat every uploaded document as an independent contract record. Do not reintroduce parent selection, family projections, effective-family values, supersession history, or family-level alerts. Dormant database linkage columns may remain for compatibility but must not affect API or product behavior.

**Why:** The product intentionally retired parent-agreement and contract-family behavior so each saved document has direct, predictable values, deadlines, ownership, and alerts.

**How to apply:** Save, list, reopen, update, filter, and alert on each contract ID independently. Keep dormant linkage storage out of requests and responses unless a future migration explicitly removes it.