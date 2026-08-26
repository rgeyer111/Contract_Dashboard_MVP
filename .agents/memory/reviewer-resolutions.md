---
name: Reviewer resolutions
description: How human issue resolution coexists with source extraction provenance.
---

Persist an explicit reviewer-resolution marker separately from the extraction status and evidence. Editing a value clears that marker; resolving without changing evidence sets it.

**Why:** A reviewer may legitimately accept an ambiguous value or confirm that a value is not stated. Rewriting the extraction status to `found` would fabricate source evidence, while keeping resolution only in UI state makes the issue return after reload.

**How to apply:** Issue counts and issue-first review queues should ignore reviewer-resolved fields, but the original extraction status, confidence, quote, and visibly unknown values must remain available.