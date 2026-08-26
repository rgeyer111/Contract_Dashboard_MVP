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
  if (!exitDate) return blocked("blocked — initial term end date is unavailable");

  const renewal = fields.renewalMechanism?.value;
  const renewalTerm = fields.renewalTermLength?.value as Period | null;
  if (renewal === "indefinite") return blocked("blocked — indefinite contract has no exit date");
  if (renewal === "auto_renew" && exitDate < today) {
    if (!renewalTerm) return blocked("blocked — renewal term length is unavailable");
    while (exitDate < today) exitDate = addPeriod(exitDate, renewalTerm);
  }

  const noticeField = fields.noticePeriod;
  if (noticeField?.status === "not_found" || !noticeField?.value) {
    return blocked("blocked — no notice clause found");
  }
  if (noticeField.status === "ambiguous") return blocked("blocked — notice period is ambiguous");
  if (noticeField.status === "conflicting") return blocked("blocked — notice period conflicting");
  const notices = Array.isArray(noticeField.value) ? noticeField.value : [noticeField.value];
  if (notices.length !== 1) return blocked("blocked — multiple applicable notice periods");
  const notice = notices[0] as Notice;
  if (!notice || !notice.amount || !notice.unit) return blocked("blocked — notice period is incomplete");
  if (notice.anchor === "unknown") return blocked("blocked — notice period stated, anchor unclear");
  if (notice.anchor === "any_time") return blocked("blocked — notice can be served at any time");

  const anchorDate = resolveAnchorDate(exitDate, effectiveDate ?? exitDate, notice.anchor, today);
  if (!anchorDate) return blocked("blocked — notice anchor cannot be resolved");
  const noticeDeadline = addPeriod(anchorDate, notice, -1);
  const actionDate = addDays(noticeDeadline, -(contract.assignment.negotiationBufferDays ?? 0));

  return {
    exitDate: formatDate(exitDate),
    noticeDeadline: formatDate(noticeDeadline),
    actionDate: formatDate(actionDate),
    status: statusFor(today, actionDate, noticeDeadline, exitDate, renewal),
    reason: null,
  };
}