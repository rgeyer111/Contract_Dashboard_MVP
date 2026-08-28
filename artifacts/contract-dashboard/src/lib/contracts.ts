import type {
  ContractReviewRecord,
  ProvenanceMetadata,
  SavedContract,
} from "@workspace/api-client-react";

export function createEmptyProvenanceMetadata(): ProvenanceMetadata {
  return {
    status: 'not_found',
    confidence: 'low',
    page: null,
    clause: null,
    quote: null,
    note: null,
  };
}

export function createEmptyContractReviewRecord(): ContractReviewRecord {
  return {
    fields: {
      documentType: { ...createEmptyProvenanceMetadata(), value: null },
      documentLanguage: { ...createEmptyProvenanceMetadata(), value: null },
      vendorLegalName: { ...createEmptyProvenanceMetadata(), value: null },
      buyerLegalEntity: { ...createEmptyProvenanceMetadata(), value: null },
      contractTitle: { ...createEmptyProvenanceMetadata(), value: null },
      contractNumber: { ...createEmptyProvenanceMetadata(), value: null },
      contractType: { ...createEmptyProvenanceMetadata(), value: null },
      signatureDate: { ...createEmptyProvenanceMetadata(), value: null },
      effectiveDate: { ...createEmptyProvenanceMetadata(), value: null },
      initialTermLength: { ...createEmptyProvenanceMetadata(), value: null },
      initialTermEndDate: { ...createEmptyProvenanceMetadata(), value: null },
      renewalMechanism: { ...createEmptyProvenanceMetadata(), value: null },
      renewalTermLength: { ...createEmptyProvenanceMetadata(), value: null },
      noticePeriod: { ...createEmptyProvenanceMetadata(), value: null },
      noticeDeadline: { ...createEmptyProvenanceMetadata(), value: null },
      noticeDelivery: { ...createEmptyProvenanceMetadata(), value: null },
      contractValue: { ...createEmptyProvenanceMetadata(), value: null },
      billingFrequency: { ...createEmptyProvenanceMetadata(), value: null },
    },
    assignment: {
      owner: '',
      ownerEmail: 'john.doe@example.com',
      negotiationBufferDays: 30,
      negotiationBufferSource: 'global_default',
      status: 'Review Open',
    },
    computed: {
      exitDate: null,
      noticeDeadline: null,
      actionDate: null,
      daysRemaining: null,
      status: 'blocked',
      reasonCode: 'CONTRACT_END_UNESTABLISHED',
      reason: null,
    },
    alert: null,
  };
}

export const documentTypeOptions = ['master_agreement', 'order_form', 'amendment', 'renewal_letter', 'termination_notice', 'quote_or_proposal', 'unknown'] as const;

export function getSavedContractDocumentType(saved: Pick<SavedContract, "documentType" | "contract">) {
  return saved.documentType ?? saved.contract.fields.documentType.value;
}

export function getDocumentTypeCounts(savedContracts: SavedContract[]) {
  return savedContracts.reduce<Record<string, number>>((counts, saved) => {
    const documentType = getSavedContractDocumentType(saved);
    if (documentType) {
      counts[documentType] = (counts[documentType] ?? 0) + 1;
    }
    return counts;
  }, {});
}

export const languageOptions = ['en', 'de', 'fr', 'it', 'other'] as const;
export const contractTypeOptions = ['maintenance', 'software_license', 'saas_subscription', 'real_estate', 'infrastructure', 'professional_services', 'data_services', 'equipment_lease', 'other'] as const;
export const renewalMechanismOptions = ['auto_renew', 'expires', 'by_mutual_agreement', 'indefinite', 'unknown'] as const;
export const billingFrequencyOptions = ['annual', 'quarterly', 'monthly', 'one_time', 'milestone', 'usage'] as const;
export const periodUnitOptions = ['days', 'weeks', 'months', 'years'] as const;

export const noticePeriodUnitOptions = [...periodUnitOptions, 'business_days'] as const;
export const contractValueBasisOptions = ['total_contract_value', 'annual', 'monthly', 'per_unit', 'not_to_exceed', 'variable'] as const;
export const assignmentStatusOptions = ['At Risk', 'Review Open', 'In Negotiation'] as const;
