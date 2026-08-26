type Period = { amount: number; unit: "days" | "weeks" | "months" | "years" };
type Notice = Period & {
  anchor:
    | "term_end"
    | "renewal_date"
    | "anniversary"
    | "period_end_month"
    | "period_end_quarter"
    | "period_end_year"
    | "any_time"
    | "unknown";
  purpose?: "non_renewal" | "termination_for_convenience" | "other" | null;
};

export type ComputedContractDates = {
  exitDate: string | null;
  noticeDeadline: string | null;
  actionDate: string | null;
  status: "green" | "amber" | "red" | "expired" | "blocked";
  reason: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addPeriod(date: Date, period: Period, direction = 1) {
  const result = new Date(date);
  const amount = period.amount * direction;
  if (period.unit === "days") result.setUTCDate(result.getUTCDate() + amount);
  if (period.unit === "weeks") result.setUTCDate(result.getUTCDate() + amount * 7);
  if (period.unit === "months" || period.unit === "years") {
    const months = amount * (period.unit === "years" ? 12 : 1);
    const originalDay = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(originalDay, lastDay));
  }
  return result;
}

function addDays(date: Date, days: number) {
  return addPeriod(date, { amount: days, unit: "days" });
}

function blocked(reason: string): ComputedContractDates {
  return { exitDate: null, noticeDeadline: null, actionDate: null, status: "blocked", reason };
}

const timingFieldNames = [
  "effectiveDate",
  "initialTermLength",
  "initialTermEndDate",
  "renewalMechanism",
  "renewalTermLength",
  "noticePeriod",
] as const;

function hasConflictingTimingValue(fields: Record<string, any>) {
  return timingFieldNames.some((name) => fields[name]?.status === "conflicting");
}

function hasPoorTimingEvidence(fields: Record<string, any>) {
  return timingFieldNames.some(
    (name) => fields[name]?.status === "found" && fields[name]?.confidence === "low",
  );
}

function nextAnniversary(date: Date, today: Date) {
  let candidate = new Date(Date.UTC(today.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (candidate < today) candidate = new Date(Date.UTC(today.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate()));
  return candidate;
}

function periodEnd(date: Date, anchor: Notice["anchor"]) {
  if (anchor === "period_end_month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  }
  if (anchor === "period_end_quarter") {
    const endMonth = Math.floor(date.getUTCMonth() / 3) * 3 + 2;
    return new Date(Date.UTC(date.getUTCFullYear(), endMonth + 1, 0));
  }
  return new Date(Date.UTC(date.getUTCFullYear(), 11, 31));
}

function resolveAnchorDate(exitDate: Date, effectiveDate: Date, anchor: Notice["anchor"], today: Date) {
  if (anchor === "term_end" || anchor === "renewal_date") return exitDate;
  if (anchor === "anniversary") return nextAnniversary(effectiveDate, today);
  if (
    anchor === "period_end_month" ||
    anchor === "period_end_quarter" ||
    anchor === "period_end_year"
  ) {
    let candidate = periodEnd(exitDate, anchor);
    if (candidate < today) {
      candidate = periodEnd(addPeriod(candidate, { amount: 1, unit: "years" }), anchor);
    }
    return candidate;
  }
  return null;
}

function statusFor(today: Date, actionDate: Date, noticeDeadline: Date, exitDate: Date, renewal: string) {
  if (renewal === "expires" && exitDate < today) return "expired" as const;
  if (today > noticeDeadline) return "red" as const;
  if (today >= actionDate) return "amber" as const;
  return "green" as const;
}

export function computeContractDates(
  contract: {
    fields: Record<string, any>;
    assignment: { negotiationBufferDays: number };
  },
  now = new Date(),
): ComputedContractDates {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fields = contract.fields;
  const effectiveDate = parseDate(fields.effectiveDate?.value);
  const explicitEndDate = parseDate(fields.initialTermEndDate?.value);
  const initialTerm = fields.initialTermLength?.value as Period | null;
  let exitDate = explicitEndDate;

  if (!exitDate && effectiveDate && initialTerm) exitDate = addPeriod(effectiveDate, initialTerm);
  if (!exitDate) {
    return blocked(
      "blocked — contract end cannot be established. Add the initial term end date, or confirm the effective date and term length.",
    );
  }

  const renewal = fields.renewalMechanism?.value;
  const renewalTerm = fields.renewalTermLength?.value as Period | null;
  if (renewal === "indefinite") {
    return blocked(
      "blocked — this contract is indefinite, so there is no fixed exit date. Confirm a fixed contractual anchor or add a documented end date.",
    );
  }
  if (renewal === "auto_renew" && exitDate < today) {
    if (!renewalTerm) {
      return blocked(
        "blocked — the past-due auto-renewal term is missing. Add the renewal term length so the current exit date can be established.",
      );
    }
    while (exitDate < today) exitDate = addPeriod(exitDate, renewalTerm);
  }

  const noticeField = fields.noticePeriod;
  if (noticeField?.status === "not_found" || !noticeField?.value) {
    return blocked(
      "blocked — no notice clause was found. Add or confirm the applicable notice period and cite its contract clause.",
    );
  }
  if (hasConflictingTimingValue(fields)) {
    return blocked(
      "blocked — conflicting contract timing values were found. Resolve the conflict by confirming the value in the controlling contract or amendment.",
    );
  }
  if (noticeField.status === "ambiguous") {
    return blocked(
      "blocked — more than one notice timing may apply. Confirm the single applicable notice period and its source clause.",
    );
  }
  const notices = Array.isArray(noticeField.value) ? noticeField.value : [noticeField.value];
  if (notices.length !== 1) {
    return blocked(
      "blocked — multiple applicable notice periods were found. Select the one that controls this renewal and cite its source clause.",
    );
  }
  const notice = notices[0] as Notice;
  if (!notice || !notice.amount || !notice.unit) {
    return blocked(
      "blocked — the notice period is missing its amount or unit. Complete the notice period and confirm its source clause.",
    );
  }
  if (notice.anchor === "unknown") {
    return blocked(
      "blocked — notice period stated; anchor unclear. Confirm whether it runs from term end, renewal date, anniversary, or another documented date.",
    );
  }
  if (hasPoorTimingEvidence(fields)) {
    return blocked(
      "blocked — timing evidence from the scan is too uncertain to trust. Upload a clearer scan or confirm the highlighted timing fields and their source clauses.",
    );
  }
  if (notice.anchor === "any_time") {
    return blocked(
      "blocked — the notice clause allows notice at any time, so no single deadline can be trusted. Confirm a fixed contractual anchor or record the applicable termination rule.",
    );
  }

  const anchorDate = resolveAnchorDate(exitDate, effectiveDate ?? exitDate, notice.anchor, today);
  if (!anchorDate) {
    return blocked(
      "blocked — the notice anchor cannot be resolved. Confirm the clause that fixes the date from which the notice period runs.",
    );
  }
  const noticeDeadline = addPeriod(anchorDate, notice, -1);
  const actionDate = addDays(noticeDeadline, -(contract.assignment.negotiationBufferDays ?? 0));
  const status = statusFor(today, actionDate, noticeDeadline, exitDate, renewal);

  return {
    exitDate: formatDate(exitDate),
    noticeDeadline: formatDate(noticeDeadline),
    actionDate: formatDate(actionDate),
    status,
    reason:
      status === "expired"
        ? "expired — the fixed contract end date has passed. Confirm whether the contract ended or renewed, then update the renewal terms before relying on this deadline."
        : null,
  };
}