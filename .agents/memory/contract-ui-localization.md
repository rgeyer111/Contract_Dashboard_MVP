---
name: Contract UI localization
description: Defines the safe translation boundary for contract workspace interfaces.
---

Translate interface copy declaratively at the component that owns it. Never translate by traversing or mutating rendered DOM text, because contract titles, vendor names, filenames, saved-view names, quotations, and provenance evidence must remain verbatim.

**Why:** A document-wide translator can silently alter legal evidence or user-entered content when it happens to match a translation key, and React can overwrite those mutations during rerenders.

**How to apply:** Use stable UI messages and explicit interpolation around untouched data values. Localize option labels while preserving machine values, and keep Swiss number/date formatting independent from the selected interface language.