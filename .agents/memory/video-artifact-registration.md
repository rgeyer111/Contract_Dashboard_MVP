---
name: Video artifact registration
description: New video compositions must live in a registered managed artifact before preview or delivery.
---

When a video composition is produced in a separate workspace directory, it still needs to be copied into a registered video artifact before it can be restarted, previewed, or presented.

**Why:** A manually created artifact.toml does not by itself add the artifact to the workspace registry or create its managed workflow.

**How to apply:** Create or identify the registered artifact first, use its exact workflow name, then verify the managed preview and present that artifact.