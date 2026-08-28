---
name: Notice conflict auditing
description: Safety rule for independently verifying contract notice timing before deadline computation.
---

Broad multi-field extraction is not reliable evidence that a contract has only one notice period or no notice wording. Independently audit the complete document for notice timing even when the first pass returns a plausible value or omits the field.

**Why:** A broad extraction pass can miss an annex conflict while returning a believable body-clause value, creating a valid-looking but unsafe deadline. Ambiguous business-day wording can also be omitted instead of surfaced for review.

**How to apply:** Any extraction redesign must preserve an independent full-document notice audit, evidence-backed alternatives for uncertainty, and code-level blocking for units the deadline calculator cannot safely interpret.