---
name: Reviewer resolutions
description: How human issue resolution coexists with source extraction provenance.
---

Persist an explicit reviewer-resolution marker separately from the extraction status and evidence. Reviewer-edited values must remain labeled `reviewer supplied` even when resolved; resolution never becomes source provenance.

**Why:** A reviewer may legitimately accept an ambiguous value or confirm that a value is not stated. Rewriting the extraction status to `found` would fabricate source evidence, while keeping resolution only in UI state makes the issue return after reload.

**How to apply:** Issue counts and issue-first review queues should ignore reviewer-resolved fields. Preserve original evidence when only resolution changes; clear evidence and use low-confidence reviewer-supplied provenance when the value changes.