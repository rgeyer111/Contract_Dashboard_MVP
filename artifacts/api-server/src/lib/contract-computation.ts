import type { ContractComputedReasonCode } from "@workspace/api-zod";

type Period = { amount: number; unit: "days" | "weeks" | "months" | "years" };
type Notice = {
  amount: number;
  unit: Period["unit"] | "business_days";
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
  daysRemaining: number | null;
  status: "green" | "amber" | "red" | "expired" | "blocked";
  reasonCode: ContractComputedReasonCode | null;
  reason: string | null;
};
export type ComputedContractAlert = {
  owner: string;
  ownerEmail: string;
  actionDate: string;
  noticeDeadline: string;
  state: "pending" | "due" | "overdue" | "dismissed";
  dismissedReason: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SWISS_TIME_ZONE = "Europe/Zurich";
const swissDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SWISS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function swissCalendarDay(value: Date) {
  const parts = Object.fromEntries(
    swissDatePartsFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

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

function blocked(
  reasonCode: ContractComputedReasonCode,
  reason: string | null = null,
): ComputedContractDates {
  return {
    exitDate: null,
    noticeDeadline: null,
    actionDate: null,
    daysRemaining: null,
    status: "blocked",
    reasonCode,
    reason,
  };
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
  const today = swissCalendarDay(now);
  const fields = contract.fields;
  const effectiveDate = parseDate(fields.effectiveDate?.value);
  const explicitEndDate = parseDate(fields.initialTermEndDate?.value);
  const initialTerm = fields.initialTermLength?.value as Period | null;
  let exitDate = explicitEndDate;

  if (!exitDate && effectiveDate && initialTerm) exitDate = addPeriod(effectiveDate, initialTerm);
  if (!exitDate) {
    return blocked("CONTRACT_END_UNESTABLISHED");
  }

  const renewal = fields.renewalMechanism?.value;
  const renewalTerm = fields.renewalTermLength?.value as Period | null;
  if (renewal === "indefinite") {
    return blocked("INDEFINITE_WITHOUT_FIXED_ANCHOR");
  }
  if (renewal === "auto_renew" && exitDate < today) {
    if (!renewalTerm) {
      return blocked("PAST_AUTO_RENEWAL_TERM_MISSING");
    }
    while (exitDate < today) exitDate = addPeriod(exitDate, renewalTerm);
  }

  const noticeField = fields.noticePeriod;
  if (noticeField?.status === "not_found" || !noticeField?.value) {
    return blocked("NOTICE_CLAUSE_NOT_FOUND");
  }
  if (hasConflictingTimingValue(fields)) {
    return blocked("TIMING_VALUES_CONFLICT");
  }
  if (noticeField.status === "ambiguous") {
    return blocked("NOTICE_TIMING_AMBIGUOUS");
  }
  const notices = Array.isArray(noticeField.value) ? noticeField.value : [noticeField.value];
  if (notices.length !== 1) {
    return blocked("MULTIPLE_NOTICE_PERIODS");
  }
  const notice = notices[0] as Notice;
  if (!notice || !notice.amount || !notice.unit) {
    return blocked("NOTICE_PERIOD_INCOMPLETE");
  }
  if (notice.unit === "business_days") {
    return blocked("NOTICE_TIMING_AMBIGUOUS");
  }
  if (notice.anchor === "unknown") {
    return blocked("NOTICE_ANCHOR_UNKNOWN");
  }
  if (hasPoorTimingEvidence(fields)) {
    return blocked("TIMING_EVIDENCE_UNRELIABLE");
  }
  if (notice.anchor === "any_time") {
    return blocked("NOTICE_ALLOWED_ANY_TIME");
  }

  const anchorDate = resolveAnchorDate(exitDate, effectiveDate ?? exitDate, notice.anchor, today);
  if (!anchorDate) {
    return blocked("NOTICE_ANCHOR_UNRESOLVED");
  }
  const noticeDeadline = addPeriod(anchorDate, notice as Period, -1);
  const actionDate = addDays(noticeDeadline, -(contract.assignment.negotiationBufferDays ?? 0));
  const daysRemaining = Math.round((actionDate.getTime() - today.getTime()) / DAY_MS);
  const status = statusFor(today, actionDate, noticeDeadline, exitDate, renewal);

  return {
    exitDate: formatDate(exitDate),
    noticeDeadline: formatDate(noticeDeadline),
    actionDate: formatDate(actionDate),
    daysRemaining,
    status,
    reasonCode: status === "expired" ? "FIXED_CONTRACT_END_PASSED" : null,
    reason: null,
  };
}

export function computeContractAlert(
  computed: ComputedContractDates,
  assignment: { owner: string; ownerEmail: string },
  previous?: Partial<ComputedContractAlert> | null,
  now = new Date(),
): ComputedContractAlert | null {
  if (
    computed.status === "blocked" ||
    computed.status === "expired" ||
    !computed.actionDate ||
    !computed.noticeDeadline
  ) {
    return null;
  }
  const today = formatDate(swissCalendarDay(now));
  const sameDeadline =
    previous?.actionDate === computed.actionDate &&
    previous.noticeDeadline === computed.noticeDeadline &&
    previous.owner === assignment.owner;
  let state: ComputedContractAlert["state"];
  if (sameDeadline && previous?.state === "dismissed") {
    state = "dismissed";
  } else if (today > computed.noticeDeadline) {
    state = "overdue";
  } else if (today >= computed.actionDate) {
    state = "due";
  } else {
    state = "pending";
  }
  return {
    owner: assignment.owner,
    ownerEmail: assignment.ownerEmail,
    actionDate: computed.actionDate,
    noticeDeadline: computed.noticeDeadline,
    state,
    dismissedReason: state === "dismissed" && sameDeadline ? previous?.dismissedReason ?? null : null,
  };
}