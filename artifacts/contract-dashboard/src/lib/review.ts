import type {
  ContractExtractionResult,
  ContractReviewRecord,
  ProvenanceMetadata,
} from "@workspace/api-client-react";
import { formatSwissNumber } from "./registry";
import { localize, type UiLanguage } from "./i18n";

export const extractionStorageKey = "contract-dashboard.extraction";
export const extractionQueueStorageKey = "contract-dashboard.extraction-queue";
export const reviewerEditNote = "Reviewer-supplied value; original extraction evidence was cleared.";
export const noticeAnchorOptions = [
  "term_end",
  "renewal_date",
  "anniversary",
  "period_end_month",
  "period_end_quarter",
  "period_end_year",
  "any_time",
  "unknown",
] as const;

export type FieldKey = keyof ContractReviewRecord["fields"];
export type AnyField = ProvenanceMetadata & { value: any; originalValue?: any };
export type FieldEditorKind = "text" | "select" | "period" | "notice" | "json" | "value" | "computed";

export type IssueDefinition = {
  key: FieldKey;
  label: string;
  section: string;
  prompt: string;
  hint: string;
};

export const issueDefinitions: IssueDefinition[] = [
  {
    key: "vendorLegalName",
    label: "Vendor legal name",
    section: "Identity",
    prompt: "Which legal entity is the supplier?",
    hint: "This name is used across the registry and owner notifications.",
  },
  {
    key: "contractType",
    label: "Contract type",
    section: "Commercial terms",
    prompt: "Which contract category best matches this agreement?",
    hint: "Used to compare similar renewal exposure.",
  },
  {
    key: "contractNumber",
    label: "Contract number",
    section: "Identity",
    prompt: "What identifier should the team use to find this agreement?",
    hint: "Use the document number, reference, or internal ID.",
  },
  {
    key: "effectiveDate",
    label: "Effective date",
    section: "Timing",
    prompt: "When did this agreement become effective?",
    hint: "The effective date anchors the contract timeline.",
  },
  {
    key: "initialTermLength",
    label: "Initial term length",
    section: "Timing",
    prompt: "How long is the initial term?",
    hint: "Enter the duration exactly as the agreement defines it.",
  },
  {
    key: "initialTermEndDate",
    label: "Initial term end date",
    section: "Timing",
    prompt: "When does the current term end?",
    hint: "This is the anchor for renewal and notice calculations.",
  },
  {
    key: "renewalMechanism",
    label: "Renewal mechanism",
    section: "Renewal",
    prompt: "How does this agreement continue or end?",
    hint: "Choose the clause behavior, not the business team's preference.",
  },
  {
    key: "noticePeriod",
    label: "Notice period",
    section: "Renewal",
    prompt: "How much notice is required before the term ends?",
    hint: "The legal notice deadline is calculated from this value.",
  },
  {
    key: "contractValue",
    label: "Contract value",
    section: "Commercial terms",
    prompt: "What value should the registry track?",
    hint: "Leave it as not stated when the document provides no reliable value.",
  },
];

export const detailGroups: Array<{
  title: string;
  fields: Array<{ key: FieldKey; label: string; kind: FieldEditorKind }>;
}> = [
  {
    title: "Document",
    fields: [
      { key: "documentType", label: "Document type", kind: "select" },
      { key: "documentLanguage", label: "Language", kind: "select" },
      { key: "vendorLegalName", label: "Vendor legal name", kind: "text" },
      { key: "buyerLegalEntity", label: "Buyer legal entity", kind: "text" },
      { key: "contractTitle", label: "Contract title", kind: "text" },
      { key: "contractNumber", label: "Contract number", kind: "text" },
    ],
  },
  {
    title: "Dates & renewal",
    fields: [
      { key: "signatureDate", label: "Signature date", kind: "text" },
      { key: "effectiveDate", label: "Effective date", kind: "text" },
      { key: "initialTermLength", label: "Initial term length", kind: "period" },
      { key: "initialTermEndDate", label: "Initial term end date", kind: "text" },
      { key: "renewalMechanism", label: "Renewal mechanism", kind: "select" },
      { key: "renewalTermLength", label: "Renewal term length", kind: "period" },
      { key: "noticePeriod", label: "Notice period", kind: "notice" },
      { key: "noticeDeadline", label: "Notice deadline", kind: "computed" },
      { key: "noticeDelivery", label: "Notice delivery", kind: "json" },
    ],
  },
  {
    title: "Commercial",
    fields: [
      { key: "contractType", label: "Contract type", kind: "select" },
      { key: "contractValue", label: "Contract value", kind: "value" },
      { key: "billingFrequency", label: "Billing frequency", kind: "select" },
    ],
  },
];

export function readStoredExtraction(): ContractExtractionResult | null {
  try {
    const saved = sessionStorage.getItem(extractionStorageKey);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as ContractExtractionResult;
    return parsed?.filename && parsed?.extraction?.contract ? parsed : null;
  } catch {
    return null;
  }
}

export function readExtractionQueue(): ContractExtractionResult[] {
  try {
    const saved = sessionStorage.getItem(extractionQueueStorageKey);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.filename && item?.extraction?.contract)
      : [];
  } catch {
    return [];
  }
}

export function getField(record: ContractReviewRecord, key: FieldKey): AnyField {
  return record.fields[key] as AnyField;
}

export function hasValue(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some((item) => item !== null && item !== "");
  return true;
}

export function displayValue(value: any, language: UiLanguage = "en"): string {
  if (!hasValue(value)) return localize(language, "Not stated");
  if (typeof value === "object") {
    if ("currency" in value) {
      const amount = typeof value.amount === "number" ? formatSwissNumber(value.amount) : "";
      return `${value.currency ?? ""} ${amount}`.trim();
    }
    if ("amount" in value) return `${value.amount ?? ""} ${localize(language, value.unit ?? "")}`.trim();
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : item}`)
      .join(" · ");
  }
  return String(value).replace(/_/g, " ");
}

export function statusLabel(status: AnyField["status"], language: UiLanguage = "en") {
  return localize(language, status.replace("_", " "));
}

export function isIssue(field: AnyField) {
  return !field.reviewed && (field.status !== "found" || !hasValue(field.value));
}

export function issuePriority(field: AnyField) {
  return field.status === "ambiguous" || field.status === "conflicting" ? 0 : 1;
}

export function isValidOwnerEmail(value: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

export function formatDate(value: string | null | undefined, language: UiLanguage = "en") {
  if (!value) return localize(language, "Not calculated");
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}
