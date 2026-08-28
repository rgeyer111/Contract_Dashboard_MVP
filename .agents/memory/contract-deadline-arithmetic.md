---
name: Contract deadline arithmetic
description: Durable rules for notice deadlines, action dates, and negotiation buffers.
---

Deadline dates are deterministic application output, never model output. The legal notice deadline is the exit date minus the notice period; the action date is the notice deadline minus the negotiation buffer. `daysRemaining` counts whole Europe/Zurich calendar days to the action date, not the legal notice deadline. Business-day or Werktage periods must remain literal and ambiguous; never convert them to calendar days without an explicit business-calendar policy.

**Why:** The negotiation buffer is additive runway before the legal cutoff. Carving it out of the notice period silently shortens the time available to renegotiate and makes short-notice contracts especially unsafe. Counting to the action date makes the number operational; amber/red status distinguishes an open negotiation window from a missed legal deadline. Europe/Zurich is the product timezone, so UTC or browser-local "today" can make status and snooze validation one day wrong near midnight. Business-day arithmetic depends on calendars and holidays that the application does not currently model, so a guessed conversion can create a false legal deadline.

**How to apply:** Compute and validate all dates and the countdown server-side using the Europe/Zurich calendar day; client-side date constraints must use the same timezone. Preserve a refusal state with a reason and a null countdown when the anchor, required clause, conflict, ambiguity, or unsupported business-day unit is unresolved. Keep the buffer human-assigned and retain whether it is an override or inherited default.