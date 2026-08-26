---
name: OpenAPI code generation
description: Constraints for keeping the workspace's Orval-generated Zod validators compatible and lossless.
---

In the API specification, represent integer-valued numbers as `type: number` with `multipleOf: 1`, and represent date-only strings with a `YYYY-MM-DD` pattern rather than `format: date`.

**Why:** The installed Orval/Zod combination emits an unavailable `zod.int()` helper for OpenAPI integers. It also turns `format: date` strings into JavaScript Dates, causing date-only values to become midnight ISO timestamps when responses are serialized.

**How to apply:** Use these schema forms for contract periods, page numbers, counters, and date-only provenance values, then regenerate both API clients from the OpenAPI source.