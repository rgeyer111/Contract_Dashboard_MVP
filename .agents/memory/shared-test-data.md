---
name: Shared test data
description: Development database behavior when regression tests persist contract fixtures.
---

Regression tests that post contracts through the shared development API can leave fixture records in the development registry, making the dashboard appear to contain duplicate business data.

**Why:** The tests exercise real persistence and their generated filenames make the leftovers look like repeated contracts rather than test artifacts.

**How to apply:** Prefer isolated test data or teardown for persistence tests. If the shared development registry is polluted, identify records by test-only filename patterns before removing them; never delete rows based only on matching vendor or contract title.