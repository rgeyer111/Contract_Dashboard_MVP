export type ContractValue = {
  status: 'stated' | 'unknown';
  amount?: number;
  currency?: string;
};

export type ContractStatus = 'At Risk' | 'Review Open' | 'In Negotiation';

export type Contract = {
  id: string;
  vendor: string;
  contractName: string;
  contractType: string;
  contractValue: ContractValue;
  startDate: string;
  endDate: string;
  noticePeriod: string;
  noticeDeadline: string;
  owner: string;
  status: ContractStatus;
};

export const demoContracts: Contract[] = [
  {
    id: 'salesforce-crm',
    vendor: 'Salesforce',
    contractName: 'CRM Platform',
    contractType: 'Software License',
    contractValue: { status: 'stated', amount: 240000, currency: 'USD' },
    startDate: 'Jan 01, 2024',
    endDate: 'Oct 15, 2024',
    noticePeriod: '90 days',
    noticeDeadline: 'Jul 17, 2024',
    owner: 'John Doe',
    status: 'At Risk',
  },
  {
    id: 'aws-cloud',
    vendor: 'AWS',
    contractName: 'Cloud Infrastructure',
    contractType: 'Infrastructure',
    contractValue: { status: 'unknown' },
    startDate: 'Nov 01, 2023',
    endDate: 'Nov 01, 2024',
    noticePeriod: '60 days',
    noticeDeadline: 'Sep 02, 2024',
    owner: 'Sarah Miller',
    status: 'Review Open',
  },
  {
    id: 'datadog-monitoring',
    vendor: 'Datadog',
    contractName: 'Monitoring',
    contractType: 'Software License',
    contractValue: { status: 'stated', amount: 120000, currency: 'USD' },
    startDate: 'Dec 12, 2023',
    endDate: 'Dec 12, 2024',
    noticePeriod: '30 days',
    noticeDeadline: 'Nov 12, 2024',
    owner: 'John Doe',
    status: 'In Negotiation',
  },
];