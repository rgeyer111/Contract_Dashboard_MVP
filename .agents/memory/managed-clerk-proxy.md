---
name: Managed Clerk proxy
description: Replit-managed Clerk proxy behavior across development and published deployments.
---

Keep the web Clerk provider wired unconditionally to `VITE_CLERK_PROXY_URL`, but do not hardcode the proxy path or require the variable during development. Require it when `REPLIT_DEPLOYMENT=1` so a published build fails rather than silently shipping broken authentication.

**Why:** Replit-managed Clerk intentionally leaves the proxy variable empty in development and injects it for Publish. Local production-mode builds alone do not reproduce that deployment environment, which can make correct canonical wiring look unused.

**How to apply:** Test development authentication with Clerk's programmatic claims and a protected same-origin API fetch. Separately test a deployment-style build with both `REPLIT_DEPLOYMENT=1` and a configured `VITE_CLERK_PROXY_URL`.