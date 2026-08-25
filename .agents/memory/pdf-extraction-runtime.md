---
name: PDF extraction runtime
description: Server-side PDF text extraction dependency choice and compatibility constraint.
---

Use the Node-focused PDF parser interface for server text extraction; the newer general package entry can eagerly load browser canvas globals and prevent the API server from starting.

**Why:** The server runtime does not provide DOMMatrix, ImageData, or Path2D, and a browser-oriented entry crashed during startup before requests could be handled.

**How to apply:** Keep PDF processing text-only for this MVP and verify the API starts in the managed workflow after any parser upgrade.