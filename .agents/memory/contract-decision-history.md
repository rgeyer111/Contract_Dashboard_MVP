---
name: Contract decision history
description: Audit rule separating recurring contract choices from extraction review.
---

Record Renew, Renegotiate, Cancel, and Snooze as append-only business events. Do not represent them as edits to extracted contract fields or reviewer-resolution provenance.

**Why:** Extraction corrections answer what the signed document says, while recurring decisions answer what a person chose at a point in time. Mixing them destroys both provenance and decision history.

**How to apply:** Give every decision its actor and server-owned timestamp; require a future date for Snooze. Show the latest event for convenience while preserving the full event history independently of later extraction edits.