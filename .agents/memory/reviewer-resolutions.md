---
name: Reviewer resolutions
description: How human issue resolution coexists with source extraction provenance.
---

Persist an explicit reviewer-resolution marker separately from the extraction status and evidence. Reviewer-edited values must remain labeled `reviewer supplied` even when resolved; resolution never becomes source provenance.

**Why:** A reviewer may legitimately accept an ambiguous value or confirm that a value is not stated. Rewriting the extraction status to `found` would fabricate source evidence, while keeping resolution only in UI state makes the issue return after reload.

**How to apply:** Issue counts and issue-first review queues should ignore reviewer-resolved fields. Preserve original evidence when only resolution changes; clear evidence and use low-confidence reviewer-supplied provenance when the value changes.

The first extracted value is immutable audit data, including when it was explicitly `null`. On updates, derive it only from persisted provenance; never trust a client-supplied original value or use nullish fallback that mistakes a recorded `null` for absence.

**Why:** Repeated edits and forged update payloads can otherwise replace the true extraction history with an intermediate or fabricated reviewer value.

**How to apply:** Detect original-value presence by property ownership. For model ambiguity or conflict, retain at least two typed alternatives, each with its own page and verbatim quote, and validate each alternative using the containing field's value rules before saving.