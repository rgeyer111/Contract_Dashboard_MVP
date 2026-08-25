---
name: PDF extraction runtime
description: Server-side PDF text extraction dependency choice and compatibility constraint.
---

Use the Node-focused PDF parser interface for embedded text extraction; the newer general package entry can eagerly load browser canvas globals and prevent the API server from starting. Scanned PDFs are rendered with the system `pdftoppm` binary before vision OCR.

**Why:** The server runtime does not provide DOMMatrix, ImageData, or Path2D, and a browser-oriented entry crashed during startup before requests could be handled. The managed runtime supplies `pdftoppm`, avoiding a browser canvas dependency for scanned-page rendering.

**How to apply:** Keep PDF parsing and page rendering on server-safe interfaces, clean up temporary rendered pages, and verify the API starts in the managed workflow after any parser or renderer upgrade.