import type {
  ContractAssignmentNegotiationBufferSource,
  ContractValueValue,
  NoticePeriodValue,
  ProvenanceContractTypeFieldValue,
  ProvenanceDocumentTypeFieldValue,
  ProvenanceRenewalMechanismFieldValue,
  SavedContract,
} from "@workspace/api-client-react";
import { ProvenanceDocumentTypeFieldValue as documentTypeValues } from "@workspace/api-client-react";
import { documentTypeOptions } from "./contracts";
import {
  translate,
  translateDomainOption,
  type MessageId,
  type UiLanguage,
} from "./i18n";

export const DOCUMENT_TYPE_QUERY_PARAM = "documentType";
export const SEARCH_QUERY_PARAM = "search";
export const SWISS_LOCALE = "de-CH";
export const SWISS_TIME_ZONE = "Europe/Zurich";

export function formatSwissNumber(value: number) {
  return new Intl.NumberFormat(SWISS_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCurrencyTotals(values: Array<ContractValueValue | null>) {
  const totals = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    totals.set(value.currency, (totals.get(value.currency) ?? 0) + value.amount);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right, SWISS_LOCALE))
    .map(([currency, amount]) => `${currency} ${formatSwissNumber(amount)}`)
    .join(" · ");
}

export function formatSwissDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(SWISS_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: SWISS_TIME_ZONE,
  }).format(date);
}

export function getSwissDateOnly(value = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SWISS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatContractType(value: ProvenanceContractTypeFieldValue, language: UiLanguage = "en") {
  return value
    ? translateDomainOption(language, value)
    : translate(language, "ui.type.not.stated");
}

export function formatDocumentType(value: NonNullable<ProvenanceDocumentTypeFieldValue>, language: UiLanguage = "en") {
  return translateDomainOption(language, value);
}

export function formatContractValue(value: ContractValueValue | null, language: UiLanguage = "en") {
  if (!value) {
    return translate(language, "ui.value.not.stated");
  }
  return translate(language, "registry.contractValue", {
    currency: value.currency,
    amount: formatSwissNumber(value.amount),
    basis: translateDomainOption(language, value.basis),
  });
}

export function formatPeriod(value: NoticePeriodValue | NoticePeriodValue[] | null, language: UiLanguage = "en") {
  const periods = Array.isArray(value) ? value : value ? [value] : [];
  return periods
    .map((period) => {
      return translate(language, "registry.period", {
        amount: period.amount,
        unit: translateDomainOption(language, period.unit),
        anchor: period.anchor && period.anchor !== "term_end"
          ? translateDomainOption(language, period.anchor)
          : undefined,
      });
    })
    .filter(Boolean)
    .join(" · ") || translate(language, "ui.notice.terms.not.stated");
}

export function formatDaysRemaining(value: number | null, language: UiLanguage = "en") {
  if (value === null) return translate(language, "ui.action.date.unavailable");
  if (value === 0) return translate(language, "ui.action.starts.today");
  if (value > 0) return translate(language, "registry.daysUntilAction", { count: value });
  const overdueDays = Math.abs(value);
  return translate(language, "registry.daysPastAction", { count: overdueDays });
}

export function formatRegistryDate(value: string | null | undefined, language: UiLanguage = "en") {
  if (!value) return translate(language, "ui.not.stated");
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

export function formatRenewalMechanism(value: ProvenanceRenewalMechanismFieldValue, fallback: MessageId = "ui.not.stated", language: UiLanguage = "en") {
  return value
    ? translateDomainOption(language, value)
    : translate(language, fallback);
}

export function formatNegotiationBufferSource(value: ContractAssignmentNegotiationBufferSource, language: UiLanguage = "en") {
  return translateDomainOption(language, value);
}

export function statusClasses(status: string) {
  return status === "red"
    ? "bg-destructive/10 text-destructive border-destructive/20"
    : status === "expired"
      ? "bg-orange-500/10 text-orange-700 border-orange-500/20"
      : status === "amber"
        ? "bg-amber-500/10 text-amber-700 border-amber-500/20"
        : status === "green"
          ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
          : "bg-destructive/10 text-destructive border-destructive/20";
}

export function statusRowClasses(status: string) {
  return status === "red"
    ? "bg-destructive/[0.035]"
    : status === "amber"
      ? "bg-amber-500/[0.045]"
      : status === "expired" || status === "blocked"
        ? "bg-orange-500/[0.035]"
        : "";
}

export function getDocumentTypeFromUrl(
  search = window.location.search,
): NonNullable<ProvenanceDocumentTypeFieldValue> | "" {
  const value = new URLSearchParams(search).get(DOCUMENT_TYPE_QUERY_PARAM);
  return parseDocumentType(value);
}

export function parseDocumentType(value: string | null): NonNullable<ProvenanceDocumentTypeFieldValue> | "" {
  return value && Object.values(documentTypeValues).some((option) => option === value)
    ? value as NonNullable<ProvenanceDocumentTypeFieldValue>
    : "";
}

export function getSearchTermFromLocation(location: string) {
  const query = location.includes("?") ? location.slice(location.indexOf("?")) : "";
  return new URLSearchParams(query).get(SEARCH_QUERY_PARAM) ?? "";
}

export function updateRegistryUrl(params: URLSearchParams, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  url.search = params.toString();
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") {
    window.history.pushState(window.history.state, "", nextUrl);
  } else {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function filterContracts(
  contracts: SavedContract[],
  searchTerm: string,
  documentTypeFilter: string,
) {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  return contracts.filter((saved) => {
    const documentType = saved.documentType ?? saved.contract.fields.documentType.value;
    if (documentTypeFilter && documentType !== documentTypeFilter) return false;
    if (!normalizedSearch) return true;
    const searchableText = [
      saved.filename,
      saved.contract.fields.vendorLegalName.value,
      saved.contract.fields.contractTitle.value,
      saved.contract.fields.contractNumber.value,
    ].filter(Boolean).join(" ").toLowerCase();
    return searchableText.includes(normalizedSearch);
  });
}

export function sortContractsByUrgency(contracts: SavedContract[]) {
  return [...contracts].sort((left, right) => {
    const leftDays = left.contract.computed.daysRemaining;
    const rightDays = right.contract.computed.daysRemaining;
    if (leftDays === null && rightDays !== null) return 1;
    if (leftDays !== null && rightDays === null) return -1;
    if (leftDays !== null && rightDays !== null && leftDays !== rightDays) return leftDays - rightDays;
    const leftVendor = left.contract.fields.vendorLegalName.value || left.filename;
    const rightVendor = right.contract.fields.vendorLegalName.value || right.filename;
    return leftVendor.localeCompare(rightVendor);
  });
}