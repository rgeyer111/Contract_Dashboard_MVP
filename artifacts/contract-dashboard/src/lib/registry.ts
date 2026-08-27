import type { SavedContract } from "@workspace/api-client-react";
import { documentTypeOptions } from "./contracts";
import { localize, type UiLanguage } from "./i18n";

export const DOCUMENT_TYPE_QUERY_PARAM = "documentType";
export const SEARCH_QUERY_PARAM = "search";
export const SWISS_LOCALE = "de-CH";

export function formatSwissNumber(value: number) {
  return new Intl.NumberFormat(SWISS_LOCALE, {
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatContractType(value: string | null, language: UiLanguage = "en") {
  return value ? localize(language, value.replace(/_/g, " ")) : localize(language, "Type not stated");
}

export function formatDocumentType(value: string, language: UiLanguage = "en") {
  return localize(language, value.replace(/_/g, " "));
}

export function formatContractValue(value: { amount?: number; currency?: string; basis?: string } | null, language: UiLanguage = "en") {
  if (!value || value.amount === undefined || !value.currency || !value.basis) {
    return localize(language, "Value not stated");
  }
  return `${value.currency} ${formatSwissNumber(value.amount)} · ${localize(language, value.basis.replace(/_/g, " "))}`;
}

export function formatPeriod(value: unknown, language: UiLanguage = "en") {
  const periods = Array.isArray(value) ? value : value ? [value] : [];
  return periods
    .map((period) => {
      if (!period || typeof period !== "object") return null;
      const item = period as { amount?: number; unit?: string; anchor?: string };
      if (item.amount === undefined || !item.unit) return null;
      const anchor = item.anchor && item.anchor !== "term_end"
        ? ` ${localize(language, "before")} ${localize(language, item.anchor.replace(/_/g, " "))}`
        : "";
      return `${item.amount} ${localize(language, item.unit)}${anchor}`;
    })
    .filter(Boolean)
    .join(" · ") || localize(language, "Notice terms not stated");
}

export function formatDaysRemaining(value: number | null, language: UiLanguage = "en") {
  if (value === null) return localize(language, "Action date unavailable");
  if (value === 0) return localize(language, "Action starts today");
  if (value > 0) return language === "de-CH"
    ? `${value} Tag${value === 1 ? "" : "e"} bis zur Aktion`
    : `${value} day${value === 1 ? "" : "s"} until action`;
  const overdueDays = Math.abs(value);
  return language === "de-CH"
    ? `${overdueDays} Tag${overdueDays === 1 ? "" : "e"} nach dem Aktionsdatum`
    : `${overdueDays} day${overdueDays === 1 ? "" : "s"} past action date`;
}

export function formatRegistryDate(value: string | null | undefined, language: UiLanguage = "en") {
  if (!value) return localize(language, "Not stated");
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

export function formatLabel(value: string | null | undefined, fallback = "Not stated", language: UiLanguage = "en") {
  return value ? localize(language, value.replace(/_/g, " ")) : localize(language, fallback);
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

export function getDocumentTypeFromUrl(search = window.location.search) {
  const value = new URLSearchParams(search).get(DOCUMENT_TYPE_QUERY_PARAM);
  return value && documentTypeOptions.some((option) => option === value) ? value : "";
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