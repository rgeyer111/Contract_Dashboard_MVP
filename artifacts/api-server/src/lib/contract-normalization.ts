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
const provenanceKeys = ["status", "confidence", "page", "clause", "quote", "note", "originalValue"] as const;

function valuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function enforceProvenanceConsistency(contract: Record<string, unknown>) {
  const fields = isRecord(contract.fields) ? contract.fields : {};
  for (const field of Object.values(fields)) {
    if (!isRecord(field)) continue;
    if (field.status === "found" && (field.page === null || !field.quote)) return false;
    if (field.status === "not_found" && field.value !== null) return false;
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
      const retainedOriginalValue =
        key === "contractType"
          ? (previousField.originalValue ?? previousField.value ?? null)
          : undefined;
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
          reviewed: field.reviewed === true,
          ...(key === "contractType" ? { originalValue: retainedOriginalValue } : {}),
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