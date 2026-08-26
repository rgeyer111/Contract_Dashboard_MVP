---
name: Contract deadline arithmetic
description: Durable rules for notice deadlines, action dates, and negotiation buffers.
---

Deadline dates are deterministic application output, never model output. The legal notice deadline is the exit date minus the notice period; the action date is the notice deadline minus the negotiation buffer.

**Why:** The negotiation buffer is additive runway before the legal cutoff. Carving it out of the notice period silently shortens the time available to renegotiate and makes short-notice contracts especially unsafe.

**How to apply:** Compute and validate all dates server-side. Preserve a refusal state with a reason when the anchor or required clause is unresolved. Keep the buffer human-assigned and retain whether it is an override or inherited default.