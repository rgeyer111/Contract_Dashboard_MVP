---
name: PDF extraction runtime
description: Server-side PDF text extraction dependency choice and compatibility constraint.
---

Use the Node-focused PDF parser interface for embedded text extraction; the newer general package entry can eagerly load browser canvas globals and prevent the API server from starting. Scanned PDFs are rendered with the system `pdftoppm` binary before vision OCR. Generate selectable-text integration fixtures with a production PDF writer rather than a hand-built cross-reference table.

**Why:** The server runtime does not provide DOMMatrix, ImageData, or Path2D, and a browser-oriented entry crashed during startup before requests could be handled. The managed runtime supplies `pdftoppm`, avoiding a browser canvas dependency for scanned-page rendering. The legacy server PDF.js parser rejects some structurally valid hand-written PDFs that Poppler accepts.

**How to apply:** Keep PDF parsing and page rendering on server-safe interfaces, clean up temporary rendered pages, use a browser or established PDF library for fixtures, and verify the API starts in the managed workflow after any parser or renderer upgrade.