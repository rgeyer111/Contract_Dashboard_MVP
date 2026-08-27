import type {
  ContractExtractionResult,
  ContractReviewRecord,
  ProvenanceMetadata,
} from "@workspace/api-client-react";
import { formatSwissNumber } from "./registry";
import { translate, translateDomainOption, type MessageId, type UiLanguage } from "./i18n";

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
  label: MessageId;
  section: MessageId;
  prompt: MessageId;
  hint: MessageId;
};

export const issueDefinitions: IssueDefinition[] = [
  {
    key: "vendorLegalName",
    label: "ui.vendor.legal.name",
    section: "ui.identity",
    prompt: "ui.which.legal.entity.is.the.supplier",
    hint: "ui.this.name.is.used.across.the.registry.and.owner.notifications",
  },
  {
    key: "contractType",
    label: "ui.contract.type",
    section: "ui.commercial.terms",
    prompt: "ui.which.contract.category.best.matches.this.agreement",
    hint: "ui.used.to.compare.similar.renewal.exposure",
  },
  {
    key: "contractNumber",
    label: "ui.contract.number",
    section: "ui.identity",
    prompt: "ui.what.identifier.should.the.team.use.to.find.this.agreement",
    hint: "ui.use.the.document.number.reference.or.internal.id",
  },
  {
    key: "effectiveDate",
    label: "ui.effective.date",
    section: "ui.timing",
    prompt: "ui.when.did.this.agreement.become.effective",
    hint: "ui.the.effective.date.anchors.the.contract.timeline",
  },
  {
    key: "initialTermLength",
    label: "ui.initial.term.length",
    section: "ui.timing",
    prompt: "ui.how.long.is.the.initial.term",
    hint: "ui.enter.the.duration.exactly.as.the.agreement.defines.it",
  },
  {
    key: "initialTermEndDate",
    label: "ui.initial.term.end.date",
    section: "ui.timing",
    prompt: "ui.when.does.the.current.term.end",
    hint: "ui.this.is.the.anchor.for.renewal.and.notice.calculations",
  },
  {
    key: "renewalMechanism",
    label: "ui.renewal.mechanism",
    section: "ui.renewal",
    prompt: "ui.how.does.this.agreement.continue.or.end",
    hint: "ui.choose.the.clause.behavior.not.the.business.team.s.preference",
  },
  {
    key: "noticePeriod",
    label: "ui.notice.period",
    section: "ui.renewal",
    prompt: "ui.how.much.notice.is.required.before.the.term.ends",
    hint: "ui.the.legal.notice.deadline.is.calculated.from.this.value",
  },
  {
    key: "contractValue",
    label: "ui.contract.value",
    section: "ui.commercial.terms",
    prompt: "ui.what.value.should.the.registry.track",
    hint: "ui.leave.it.as.not.stated.when.the.document.provides.no.reliable.value",
  },
];

export const detailGroups: Array<{
  title: MessageId;
  fields: Array<{ key: FieldKey; label: MessageId; kind: FieldEditorKind }>;
}> = [
  {
    title: "ui.document",
    fields: [
      { key: "documentType", label: "ui.document.type", kind: "select" },
      { key: "documentLanguage", label: "ui.language", kind: "select" },
      { key: "vendorLegalName", label: "ui.vendor.legal.name", kind: "text" },
      { key: "buyerLegalEntity", label: "ui.buyer.legal.entity", kind: "text" },
      { key: "contractTitle", label: "ui.contract.title", kind: "text" },
      { key: "contractNumber", label: "ui.contract.number", kind: "text" },
    ],
  },
  {
    title: "ui.dates.renewal",
    fields: [
      { key: "signatureDate", label: "ui.signature.date", kind: "text" },
      { key: "effectiveDate", label: "ui.effective.date", kind: "text" },
      { key: "initialTermLength", label: "ui.initial.term.length", kind: "period" },
      { key: "initialTermEndDate", label: "ui.initial.term.end.date", kind: "text" },
      { key: "renewalMechanism", label: "ui.renewal.mechanism", kind: "select" },
      { key: "renewalTermLength", label: "ui.renewal.term.length", kind: "period" },
      { key: "noticePeriod", label: "ui.notice.period", kind: "notice" },
      { key: "noticeDeadline", label: "ui.notice.deadline", kind: "computed" },
      { key: "noticeDelivery", label: "ui.notice.delivery", kind: "json" },
    ],
  },
  {
    title: "review.commercialSection",
    fields: [
      { key: "contractType", label: "ui.contract.type", kind: "select" },
      { key: "contractValue", label: "ui.contract.value", kind: "value" },
      { key: "billingFrequency", label: "ui.billing.frequency", kind: "select" },
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
  if (!hasValue(value)) return translate(language, "ui.not.stated");
  if (typeof value === "object") {
    if ("currency" in value) {
      const amount = typeof value.amount === "number" ? formatSwissNumber(value.amount) : "";
      return translate(language, "review.moneyAmount", {
        currency: String(value.currency ?? ""),
        amount,
      }).trim();
    }
    if ("amount" in value) {
      return translate(language, "review.amountUnit", {
        amount: String(value.amount ?? ""),
        unit: String(value.unit ?? ""),
      }).trim();
    }
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : item}`)
      .join(" · ");
  }
  return String(value);
}

export function statusLabel(status: AnyField["status"], language: UiLanguage = "en") {
  return translateDomainOption(language, status);
}

export function displayEvidenceValue(value: unknown, language: UiLanguage = "en"): string {
  if (!hasValue(value)) return translate(language, "ui.not.stated");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
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
  if (!value) return translate(language, "ui.not.calculated");
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}
