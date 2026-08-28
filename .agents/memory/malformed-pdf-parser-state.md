---
name: Malformed PDF parser state
description: Non-deterministic warm-state behavior when pdf-parse reads malformed cross-reference tables.
---

The same malformed-cross-reference PDF can fail on the first `pdf-parse` attempt in a fresh process but parse successfully after other parser activity.

**Why:** A real vendor fixture exercised both outcomes without its bytes changing. Pre-parsing the fixture can therefore accidentally bypass and invalidate a recovery regression.

**How to apply:** Tests that must prove normalization should call the shared recovery entry point directly in a fresh parser context. Route tests should separately prove that the real file reaches text extraction without OCR, whether direct parsing or repair succeeds.