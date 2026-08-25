---
name: Contract confirmation
description: MVP gate for moving a reviewed contract into the dashboard.
---

Before a contract enters the dashboard, require vendor, contract type, start date, contract duration, end date, notice period, negotiation buffer, owner, contract number, and a contract-value status. Contract name, notice deadline, and status are contextual fields rather than confirmation blockers.

**Why:** The user chose a complete renewal-tracking record while preserving a non-blocking path for documents whose value is not stated.

**How to apply:** Use the requirement list for review validation and make missing required fields prominent. Treat “Unknown / not stated” as a valid contract-value status with its separate red review treatment.