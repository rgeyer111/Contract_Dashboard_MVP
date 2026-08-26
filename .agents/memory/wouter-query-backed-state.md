---
name: Wouter query-backed state
description: Reliable handling for filters and other UI state stored in URL query parameters.
---

Do not derive query-backed control state solely from Wouter's `useLocation` value. Initialize controlled state from `window.location.search`, update the control and URL together, and restore from the query string on direct loads. Use a history entry for meaningful filter transitions, but replace the current entry while a user is continuously typing.

**Why:** In this runtime, navigation could update the browser query string while the value exposed to the component did not include that query change, leaving the URL and visible control out of sync.

**How to apply:** Use this pattern for shareable filters and searches. Verify selection, clear, reload, browser history, and direct-link entry as separate behaviors. Avoid pushing a new browser entry for every keystroke; push when entering or leaving a search state and replace while editing within one state.