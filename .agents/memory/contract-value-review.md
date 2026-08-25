---
name: Contract value review
description: Product decision for how missing contract values should be represented during MVP review.
---

An absent contract value is represented as “Unknown / not stated”, not as a blank or zero. It is still a mandatory review status and must be visually highlighted in red so the user notices it before confirming the contract.

**Why:** The user explicitly chose visibility without blocking the MVP on documents that do not state a value.

**How to apply:** Keep this distinction in extraction review, contract lists, and any dashboard summaries that surface incomplete records.