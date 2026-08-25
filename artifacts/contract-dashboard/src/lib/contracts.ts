export type ContractValue = {
  status: 'stated' | 'unknown';
  amount?: number;
  currency?: string;
};

export type ContractStatus = 'At Risk' | 'Review Open' | 'In Negotiation';

export type Contract = {
  id: string;
  vendor: string;
  contractNumber: string;
  contractName: string;
  contractType: string;
  contractValue: ContractValue;
  startDate: string;
  contractDuration: string;
  endDate: string;
  noticePeriod: string;
  noticeDeadline: string;
  negotiationBuffer: string;
  owner: string;
  status: ContractStatus;
};

export type ContractFieldKey =
  | 'vendor'
  | 'contractNumber'
  | 'contractName'
  | 'contractType'
  | 'contractValue'
  | 'startDate'
  | 'contractDuration'
  | 'endDate'
  | 'noticePeriod'
  | 'noticeDeadline'
  | 'negotiationBuffer'
  | 'owner'
  | 'status';

export const contractFields: ReadonlyArray<{
  key: ContractFieldKey;
  label: string;
  requiredAtConfirmation: boolean;
}> = [
  { key: 'vendor', label: 'Vendor', requiredAtConfirmation: true },
  { key: 'contractNumber', label: 'Contract #', requiredAtConfirmation: true },
  { key: 'contractName', label: 'Contract name', requiredAtConfirmation: false },
  { key: 'contractType', label: 'Contract type', requiredAtConfirmation: true },
  { key: 'contractValue', label: 'Contract value', requiredAtConfirmation: true },
  { key: 'startDate', label: 'Start date', requiredAtConfirmation: true },
  { key: 'contractDuration', label: 'Contract duration', requiredAtConfirmation: true },
  { key: 'endDate', label: 'End date', requiredAtConfirmation: true },
  { key: 'noticePeriod', label: 'Notice period', requiredAtConfirmation: true },
  { key: 'noticeDeadline', label: 'Notice deadline', requiredAtConfirmation: false },
  { key: 'negotiationBuffer', label: 'Negotiation buffer', requiredAtConfirmation: true },
  { key: 'owner', label: 'Owner', requiredAtConfirmation: true },
  { key: 'status', label: 'Status', requiredAtConfirmation: false },
];

export const currentDemoUser = {
  id: 'john-doe',
  name: 'John Doe',
  initials: 'JD',
};

export function createContractDraft(
  contract: Omit<Contract, 'id' | 'owner'> & { id?: string; owner?: string },
): Contract {
  return {
    ...contract,
    id: contract.id ?? crypto.randomUUID(),
    owner: contract.owner ?? currentDemoUser.name,
  };
}

export const demoContracts: Contract[] = [
  {
    id: 'salesforce-crm',
    vendor: 'Salesforce',
    contractNumber: 'SF-2024-4471',
    contractName: 'CRM Platform',
    contractType: 'Software License',
    contractValue: { status: 'stated', amount: 240000, currency: 'USD' },
    startDate: 'Jan 01, 2024',
    contractDuration: '12 months',
    endDate: 'Oct 15, 2024',
    noticePeriod: '90 days',
    noticeDeadline: 'Jul 17, 2024',
    negotiationBuffer: '30 days',
    owner: 'John Doe',
    status: 'At Risk',
  },
  {
    id: 'aws-cloud',
    vendor: 'AWS',
    contractNumber: 'AWS-ENT-9823',
    contractName: 'Cloud Infrastructure',
    contractType: 'Infrastructure',
    contractValue: { status: 'unknown' },
    startDate: 'Nov 01, 2023',
    contractDuration: '12 months',
    endDate: 'Nov 01, 2024',
    noticePeriod: '60 days',
    noticeDeadline: 'Sep 02, 2024',
    negotiationBuffer: '21 days',
    owner: 'Sarah Miller',
    status: 'Review Open',
  },
  {
    id: 'datadog-monitoring',
    vendor: 'Datadog',
    contractNumber: 'DD-2023-112',
    contractName: 'Monitoring',
    contractType: 'Software License',
    contractValue: { status: 'stated', amount: 120000, currency: 'USD' },
    startDate: 'Dec 12, 2023',
    contractDuration: '12 months',
    endDate: 'Dec 12, 2024',
    noticePeriod: '30 days',
    noticeDeadline: 'Nov 12, 2024',
    negotiationBuffer: '14 days',
    owner: 'John Doe',
    status: 'In Negotiation',
  },
];