---
name: OCR completeness
description: Guardrails that prevent a valid-looking OCR response from hiding missing contract content.
---

A successful scanned-contract OCR result must represent every detected PDF page and only be returned when each page's OCR completion finishes normally. If a model reports an output cutoff or an incomplete completion, reject the upload with the affected page number rather than returning a partial review draft.

**Why:** A model can return syntactically valid JSON even after reaching its output token limit, which otherwise makes incomplete transcription look like successful coverage.

**How to apply:** Keep page-level verification and completion-status checks whenever changing the renderer, vision model, or OCR batching. Any configured text-size ceiling must reject explicitly; never slice text sent to field extraction.