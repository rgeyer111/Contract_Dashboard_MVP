---
name: Extraction evaluation variability
description: How to interpret and report exact-match results from live contract-extraction model evaluations.
---

Regenerate the disagreement CSV and report from every complete live extraction run. Do not carry forward document-level or aggregate totals from an earlier run, even when only one extraction behavior changed.

**Why:** Repeated runs over the same fixed contract set produced small shifts in unrelated exact-match fields because model output is nondeterministic. Focused field improvement can be real even when the aggregate rate is flat.

**How to apply:** Use the evaluation runner as the sole source of checked-in metrics, report the observed focused-field delta, and keep strict representational differences visible rather than hand-normalizing them away.