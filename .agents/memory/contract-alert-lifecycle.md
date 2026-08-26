---
name: Contract alert lifecycle
description: Rules for creating, dismissing, and resetting contract renewal alerts.
---

Create alerts only for contracts with an owner and valid action and notice dates. Blocked and expired contracts have no actionable alert. Preserve a dismissal only while the owner, action date, and notice deadline remain unchanged.

**Why:** A dismissal records a decision about a specific obligation and recipient. If the controlling deadline or recipient changes, carrying the old dismissal forward would hide a new action requirement.

**How to apply:** Derive pending, due, and overdue server-side from current dates. Persist the dismissal reason, but reset dismissal whenever the alert identity changes.