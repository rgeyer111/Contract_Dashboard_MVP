---
name: Published demo register
description: Product-stage decision governing whether the isolated TEA-23 sample register is available in published builds.
---

Keep the isolated read-only sample register and its “Demo only” start-page entry available in published builds during the current evaluation stage.

**Why:** The published application does not yet contain customer data, and the user explicitly wants evaluators to access the synthetic register from the public deployment. A production-build exclusion would make the requested republish omit the primary demo path.

**How to apply:** Preserve strict separation from PostgreSQL and disable real-registry writes while demo mode is active. Remove the demo modules and entry cleanly only when the user decides the tool is ready for real customer production use.