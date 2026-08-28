import { CreateContractBody } from "@workspace/api-zod";
import { contractsTable, registryViewsTable } from "@workspace/db";
import { computeContractAlert, computeContractDates } from "./contract-computation";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const missing = (note: string | null = null) => ({
  value: null,
  status: "not_found" as const,
  confidence: "low" as const,
  page: null,
  clause: null,
  quote: null,
  note,
});

function legacyField(value: unknown, note = "Legacy saved value; source evidence was not retained.") {
  return value === null || value === undefined || value === ""
    ? missing()
    : {
        value,
        status: "ambiguous" as const,
        confidence: "low" as const,
        page: null,
        clause: null,
        quote: null,
        note,
      };
}

function parseLegacyPeriod(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^\s*(\d+)\s+(days?|weeks?|months?|years?)\s*$/i.exec(value);
  if (!match) return null;
  return {
    amount: Number(match[1]),
    unit: match[2].toLowerCase().replace(/s$/, "") + "s",
  };
}

const reviewerEditNote = "Reviewer-supplied value; original extraction evidence was cleared.";
const provenanceKeys = [
  "status",
  "confidence",
  "page",
  "clause",
  "quote",
  "note",
  "alternatives",
  "originalValue",
] as const;

function valuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const alternativeEnums: Record<string, readonly string[]> = {
  documentType: ["master_agreement", "order_form", "sow", "amendment", "renewal_letter", "termination_notice", "quote_or_proposal", "unknown"],
  documentLanguage: ["de", "en", "fr", "it", "other"],
  contractType: ["maintenance", "software_license", "saas_subscription", "real_estate", "infrastructure", "professional_services", "data_services", "equipment_lease", "other"],
  renewalMechanism: ["auto_renew", "expires", "by_mutual_agreement", "indefinite", "unknown"],
  billingFrequency: ["annual", "quarterly", "monthly", "one_time", "milestone", "usage"],
};

function validPeriod(value: unknown) {
  return isRecord(value) &&
    typeof value.amount === "number" &&
    Number.isInteger(value.amount) &&
    value.amount > 0 &&
    ["days", "weeks", "months", "years"].includes(String(value.unit));
}

function validNoticePeriod(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(validNoticePeriod);
  return isRecord(value) &&
    typeof value.amount === "number" &&
    Number.isInteger(value.amount) &&
    value.amount > 0 &&
    ["days", "business_days", "weeks", "months", "years"].includes(String(value.unit)) &&
    ["term_end", "renewal_date", "anniversary", "period_end_month", "period_end_quarter", "period_end_year", "any_time", "unknown"].includes(String(value.anchor)) &&
    (value.purpose === null || ["non_renewal", "termination_for_convenience", "other"].includes(String(value.purpose)));
}

function validAlternativeValue(fieldKey: string, value: unknown) {
  if (alternativeEnums[fieldKey]) {
    return typeof value === "string" && alternativeEnums[fieldKey].includes(value);
  }
  if (["vendorLegalName", "buyerLegalEntity", "contractTitle", "contractNumber"].includes(fieldKey)) {
    return typeof value === "string" && value.trim().length > 0;
  }
  if (["signatureDate", "effectiveDate", "initialTermEndDate", "noticeDeadline"].includes(fieldKey)) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
  if (["initialTermLength", "renewalTermLength"].includes(fieldKey)) return validPeriod(value);
  if (fieldKey === "noticePeriod") return validNoticePeriod(value);
  if (fieldKey === "noticeDelivery") {
    return isRecord(value) &&
      ["email", "registered_post", "post", "portal", "any_written"].includes(String(value.method)) &&
      (value.address === null || typeof value.address === "string") &&
      Array.isArray(value.cc) &&
      value.cc.every((item) => typeof item === "string");
  }
  if (fieldKey === "contractValue") {
    return isRecord(value) &&
      typeof value.amount === "number" &&
      Number.isFinite(value.amount) &&
      typeof value.currency === "string" &&
      /^[A-Z]{3}$/.test(value.currency) &&
      ["total_contract_value", "annual", "monthly", "per_unit", "not_to_exceed", "variable"].includes(String(value.basis));
  }
  return false;
}

export function enforceProvenanceConsistency(contract: Record<string, unknown>) {
  const fields = isRecord(contract.fields) ? contract.fields : {};
  for (const [fieldKey, field] of Object.entries(fields)) {
    if (!isRecord(field)) continue;
    if (field.status === "found" && (field.page === null || !field.quote)) return false;
    if (field.status === "not_found" && field.value !== null) return false;
    const alternatives = Array.isArray(field.alternatives) ? field.alternatives : [];
    const isModelUncertainty = field.note !== reviewerEditNote;
    if (isModelUncertainty && field.status === "ambiguous" && alternatives.length < 1) return false;
    if (isModelUncertainty && field.status === "conflicting" && alternatives.length < 2) return false;
    for (const rawAlternative of alternatives) {
      if (!isRecord(rawAlternative) || !validAlternativeValue(fieldKey, rawAlternative.value)) {
        return false;
      }
    }
  }
  return true;
}

export function sanitizeChangedFields(
  incoming: Record<string, unknown>,
  previous: Record<string, unknown>,
) {
  const incomingFields = isRecord(incoming.fields) ? incoming.fields : {};
  const previousFields = isRecord(previous.fields) ? previous.fields : {};
  const fields = Object.fromEntries(
    Object.entries(incomingFields).map(([key, rawField]) => {
      const field = isRecord(rawField) ? rawField : {};
      const previousField = isRecord(previousFields[key]) ? previousFields[key] : {};
      if (valuesMatch(field.value, previousField.value)) {
        const previousProvenance = Object.fromEntries(
          provenanceKeys
            .filter((provenanceKey) => provenanceKey in previousField)
            .map((provenanceKey) => [provenanceKey, previousField[provenanceKey]]),
        );
        return [
          key,
          {
            ...field,
            ...previousProvenance,
            reviewed: field.reviewed === true,
          },
        ];
      }
      const retainedOriginalValue = Object.prototype.hasOwnProperty.call(previousField, "originalValue")
        ? previousField.originalValue
        : previousField.value ?? null;
      return [
        key,
        {
          ...field,
          status: "ambiguous",
          confidence: "low",
          page: null,
          clause: null,
          quote: null,
          note: reviewerEditNote,
          alternatives: [],
          reviewed: field.reviewed === true,
          originalValue: retainedOriginalValue,
        },
      ];
    }),
  );
  return { ...incoming, fields };
}

export function withComputedDates(value: Record<string, unknown>) {
  const assignment = isRecord(value.assignment) ? value.assignment : {};
  const contract = {
    ...value,
    assignment: {
      ...assignment,
      ownerEmail:
        typeof assignment.ownerEmail === "string" && assignment.ownerEmail
          ? assignment.ownerEmail
          : "john.doe@example.com",
      negotiationBufferSource:
        assignment.negotiationBufferSource === "contract_override" ||
        assignment.negotiationBufferSource === "contract_type_default"
          ? assignment.negotiationBufferSource
          : "global_default",
    },
  };
  const computed = computeContractDates(
    contract as unknown as {
      fields: Record<string, unknown>;
      assignment: { negotiationBufferDays: number };
    },
  );
  return {
    ...contract,
    computed,
    alert: computeContractAlert(
      computed,
      contract.assignment as unknown as { owner: string; ownerEmail: string },
      isRecord(value.alert) ? value.alert as any : null,
    ),
  };
}

export function upgradeContract(value: unknown) {
  if (isRecord(value) && isRecord(value.fields) && isRecord(value.assignment)) {
    const upgraded = withComputedDates(value);
    const upgradedCanonical = CreateContractBody.safeParse({
      filename: "legacy-upgrade.pdf",
      contract: upgraded,
    });
    if (upgradedCanonical.success) return upgradedCanonical.data.contract;
  }
  const canonical = CreateContractBody.safeParse({ filename: "legacy-upgrade.pdf", contract: value });
  if (canonical.success) {
    return withComputedDates(canonical.data.contract as unknown as Record<string, unknown>);
  }
  const legacy = isRecord(value) ? value : {};
  const legacyType = {
    Maintenance: "maintenance",
    "Software License": "software_license",
    "Real Estate": "real_estate",
    Infrastructure: "infrastructure",
  }[String(legacy.contractType)] ?? null;
  const oldValue = isRecord(legacy.contractValue) ? legacy.contractValue : {};
  const statedValue =
    oldValue.status === "stated" &&
    typeof oldValue.amount === "number" &&
    typeof oldValue.currency === "string"
      ? {
          amount: oldValue.amount,
          currency: oldValue.currency.toUpperCase(),
          basis: "variable" as const,
        }
      : null;
  const notice = parseLegacyPeriod(legacy.noticePeriod);

  return withComputedDates({
    fields: {
      documentType: missing(),
      documentLanguage: missing(),
      vendorLegalName: legacyField(legacy.vendor),
      buyerLegalEntity: missing(),
      contractTitle: legacyField(legacy.contractName),
      contractNumber: legacyField(legacy.contractNumber),
      contractType: legacyField(legacyType),
      signatureDate: missing(),
      effectiveDate: legacyField(legacy.startDate),
      initialTermLength: legacyField(parseLegacyPeriod(legacy.contractDuration)),
      initialTermEndDate: legacyField(legacy.endDate),
      renewalMechanism: missing(),
      renewalTermLength: missing(),
      noticePeriod: legacyField(
        notice ? { ...notice, anchor: "unknown" as const, purpose: "non_renewal" as const } : null,
      ),
      noticeDeadline: legacyField(legacy.noticeDeadline),
      noticeDelivery: missing(),
      contractValue: legacyField(statedValue),
      billingFrequency: missing(),
    },
    assignment: {
      owner: typeof legacy.owner === "string" && legacy.owner ? legacy.owner : "John Doe",
      ownerEmail: "john.doe@example.com",
      negotiationBufferDays: parseLegacyPeriod(legacy.negotiationBuffer)?.amount ?? 30,
      negotiationBufferSource: "global_default",
      status: ["At Risk", "Review Open", "In Negotiation"].includes(String(legacy.status))
        ? legacy.status
        : "Review Open",
    },
  });
}

export function responseFor(record: typeof contractsTable.$inferSelect) {
  const contract = upgradeContract(record.contract) as Record<string, any>;
  return {
    id: record.id,
    filename: record.filename,
    documentType: record.documentType ?? contract.fields?.documentType?.value ?? null,
    sourceAvailable: Boolean(record.sourceStoragePath),
    contract,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function registryViewResponse(record: typeof registryViewsTable.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    search: record.search,
    documentType: record.documentType,
    isPinned: record.pinnedAt !== null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}