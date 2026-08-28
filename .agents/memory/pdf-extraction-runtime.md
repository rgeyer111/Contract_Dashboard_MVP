---
name: PDF extraction runtime
description: Server-side PDF text extraction dependency choice and compatibility constraint.
---

Use the Node-focused PDF parser interface for embedded text extraction; the newer general package entry can eagerly load browser canvas globals and prevent the API server from starting. Scanned PDFs are rendered with Poppler before vision OCR. The published runtime must explicitly declare `poppler-utils` and `qpdf`; tools present in development are not automatically available after publishing. Generate selectable-text integration fixtures with a production PDF writer rather than a hand-built cross-reference table.

**Why:** The server runtime does not provide DOMMatrix, ImageData, or Path2D, and a browser-oriented entry crashed during startup before requests could be handled. A deployment omitted `pdfinfo` even though it was available in development, causing every PDF preflight to fail as temporarily unavailable. Poppler avoids a browser canvas dependency for scanned-page rendering, while qpdf repairs malformed-but-readable structures. The legacy server PDF.js parser rejects some structurally valid hand-written PDFs that Poppler accepts.

**How to apply:** Keep PDF parsing and page rendering on server-safe interfaces, declare the production system tools explicitly, clean up temporary rendered pages, use a browser or established PDF library for fixtures, and verify both the managed workflow and a newly published runtime after any parser or renderer upgrade.