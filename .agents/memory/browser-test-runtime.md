---
name: Browser test runtime
description: Playwright browser checks may need explicitly exposed Nix graphics libraries in the test environment.
---

Browser-level checks are valuable for dashboard flows, but the local Chromium binary can fail before tests start when graphics and keyboard libraries such as libgbm and libxkbcommon are not exposed on the process library path.

**Why:** Installing the browser binary alone did not make Chromium launch in this Nix-based workspace.

**How to apply:** Treat a pre-launch missing-library failure as environment setup, not an application failure. Install the Playwright Chromium binary, expose libgbm and libxkbcommon through Nix, then keep the browser test intact.