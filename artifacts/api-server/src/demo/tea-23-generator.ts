import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { computeContractAlert, computeContractDates } from "../lib/contract-computation";

/**
 * The single date from which every TEA-23 fixture date and expected deadline is
 * derived. Keep this fixed so generated deliverables and evaluations are repeatable.
 */
export const TODAY = "2026-06-15";

const DAY_MS = 86_400_000;
const today = new Date(`${TODAY}T00:00:00.000Z`);

function dateAtOffset(days: number) {
  return new Date(today.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function quarterEndAtOffset(days: number) {
  const date = new Date(today.getTime() + days * DAY_MS);
  const endMonth = Math.floor(date.getUTCMonth() / 3) * 3 + 2;
  return new Date(Date.UTC(date.getUTCFullYear(), endMonth + 1, 0)).toISOString().slice(0, 10);
}

const missing = (note: string | null = null) => ({
  value: null,
  status: "not_found",
  confidence: "low",
  page: null,
  clause: null,
  quote: null,
  note,
});

const found = (value: unknown, quote = "Synthetic TEA-23 source clause.") => ({
  value,
  status: "found",
  confidence: "high",
  page: 1,
  clause: "Synthetic fixture",
  quote,
  note: null,
});

type Scenario = {
  id: string;
  label: string;
  vendor: string;
  canton: string;
  owner: string;
  documentType?: string;
  contractType?: string;
  effectiveDate?: string | null;
  endDate?: string | null;
  renewal: string;
  renewalTerm?: { amount: number; unit: string } | null;
  notice?: { amount: number; unit: string; anchor: string; purpose: string } | null;
  noticeStatus?: "found" | "conflicting";
  buffer: number;
  value: number;
};

const scenarios: Scenario[] = [
  {
    id: "tea23-quarter-end",
    label: "Quarter-end notice",
    vendor: "Helvetic Analytics AG",
    canton: "Zürich",
    owner: "Nina Keller",
    documentType: "master_agreement",
    contractType: "data_services",
    effectiveDate: dateAtOffset(-350),
    endDate: quarterEndAtOffset(70),
    renewal: "auto_renew",
    renewalTerm: { amount: 1, unit: "years" },
    notice: { amount: 30, unit: "days", anchor: "period_end_quarter", purpose: "non_renewal" },
    buffer: 14,
    value: 96000,
  },
  {
    id: "tea23-evergreen",
    label: "Evergreen / indefinite",
    vendor: "Alpine Network GmbH",
    canton: "Basel-Stadt",
    owner: "Lukas Meier",
    documentType: "order_form",
    contractType: "saas_subscription",
    effectiveDate: dateAtOffset(-720),
    endDate: dateAtOffset(180),
    renewal: "indefinite",
    notice: { amount: 60, unit: "days", anchor: "term_end", purpose: "termination_for_convenience" },
    buffer: 30,
    value: 72000,
  },
  {
    id: "tea23-conflicting-timing",
    label: "Conflicting timing",
    vendor: "Rigi Facilities AG",
    canton: "Schwyz",
    owner: "Sabrina Schmid",
    documentType: "amendment",
    contractType: "maintenance",
    effectiveDate: dateAtOffset(-400),
    endDate: dateAtOffset(140),
    renewal: "auto_renew",
    renewalTerm: { amount: 1, unit: "years" },
    notice: { amount: 90, unit: "days", anchor: "term_end", purpose: "non_renewal" },
    noticeStatus: "conflicting",
    buffer: 21,
    value: 48000,
  },
  {
    id: "tea23-unknown-anchor",
    label: "Unknown notice anchor",
    vendor: "Limmat Security SA",
    canton: "Waadt",
    owner: "Anaïs Rochat",
    documentType: "master_agreement",
    contractType: "infrastructure",
    effectiveDate: dateAtOffset(-500),
    endDate: dateAtOffset(200),
    renewal: "auto_renew",
    renewalTerm: { amount: 12, unit: "months" },
    notice: { amount: 45, unit: "days", anchor: "unknown", purpose: "non_renewal" },
    buffer: 30,
    value: 132000,
  },
  {
    id: "tea23-expired",
    label: "Expired fixed term",
    vendor: "Jura Advisory Sàrl",
    canton: "Jura",
    owner: "Mathieu Girard",
    documentType: "sow",
    contractType: "professional_services",
    effectiveDate: dateAtOffset(-400),
    endDate: dateAtOffset(-15),
    renewal: "expires",
    notice: { amount: 30, unit: "days", anchor: "term_end", purpose: "non_renewal" },
    buffer: 14,
    value: 54000,
  },
  {
    id: "tea23-blocked",
    label: "Blocked missing end",
    vendor: "Bern Mobility AG",
    canton: "Bern",
    owner: "Simon Aebischer",
    documentType: "quote_or_proposal",
    contractType: "equipment_lease",
    effectiveDate: null,
    endDate: null,
    renewal: "unknown",
    notice: { amount: 30, unit: "days", anchor: "term_end", purpose: "other" },
    buffer: 30,
    value: 87000,
  },
  {
    id: "tea23-overdue",
    label: "Overdue notice",
    vendor: "Gotthard Cloud AG",
    canton: "Tessin",
    owner: "Giulia Bernasconi",
    documentType: "order_form",
    contractType: "saas_subscription",
    effectiveDate: dateAtOffset(-300),
    endDate: dateAtOffset(46),
    renewal: "auto_renew",
    renewalTerm: { amount: 1, unit: "years" },
    notice: { amount: 60, unit: "days", anchor: "term_end", purpose: "non_renewal" },
    buffer: 14,
    value: 180000,
  },
];

function buildRecord(scenario: Scenario) {
  const noticeField = scenario.notice
    ? {
        ...found(scenario.notice),
        ...(scenario.noticeStatus === "conflicting"
          ? {
              status: "conflicting",
              confidence: "medium",
              alternatives: [
                { value: scenario.notice, page: 1, clause: "Main agreement", quote: "Main agreement timing." },
                {
                  value: { ...scenario.notice, amount: scenario.notice.amount + 30 },
                  page: 2,
                  clause: "Amendment",
                  quote: "Amendment timing.",
                },
              ],
            }
          : {}),
      }
    : missing();
  const contract: any = {
    fields: {
      documentType: found(scenario.documentType ?? "unknown"),
      documentLanguage: found("de"),
      vendorLegalName: found(scenario.vendor),
      buyerLegalEntity: found("Alpenblick Industrie AG"),
      contractTitle: found(scenario.label),
      contractNumber: found(scenario.id.toUpperCase()),
      contractType: found(scenario.contractType ?? "other"),
      signatureDate: found(dateAtOffset(-410)),
      effectiveDate: scenario.effectiveDate ? found(scenario.effectiveDate) : missing(),
      initialTermLength: missing(),
      initialTermEndDate: scenario.endDate ? found(scenario.endDate) : missing(),
      renewalMechanism: found(scenario.renewal),
      renewalTermLength: scenario.renewalTerm ? found(scenario.renewalTerm) : missing(),
      noticePeriod: noticeField,
      noticeDeadline: missing("Computed by the application."),
      noticeDelivery: found({ method: "email", address: "legal@example.test", cc: [] }),
      contractValue: found({ amount: scenario.value, currency: "CHF", basis: "annual" }),
      billingFrequency: found("annual"),
    },
    assignment: {
      owner: scenario.owner,
      ownerEmail: "owner@example.test",
      negotiationBufferDays: scenario.buffer,
      negotiationBufferSource: "contract_override",
      status: "Review Open",
    },
  };
  contract.computed = computeContractDates(contract, today);
  contract.alert = computeContractAlert(contract.computed, contract.assignment, null, today);
  return {
    id: scenario.id,
    filename: `${scenario.id}.pdf`,
    documentType: scenario.documentType ?? "unknown",
    sourceAvailable: false,
    contract,
    createdAt: `${TODAY}T09:00:00.000Z`,
    updatedAt: `${TODAY}T09:00:00.000Z`,
    demoScenario: `${scenario.label} · ${scenario.canton}`,
  };
}

export function generateTea23Fixtures() {
  return {
    metadata: {
      fixture: "TEA-23 Demo Sample Register",
      today: TODAY,
      generatedDeterministically: true,
      recordModel: "independent contracts",
    },
    records: scenarios.map(buildRecord),
  };
}

function csvCell(value: unknown) {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows: unknown[][]) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export async function writeTea23Deliverables(outputDirectory: string) {
  const fixture = generateTea23Fixtures();
  const registerRows = fixture.records.map((record) => [
    record.id,
    record.demoScenario,
    record.contract.fields.vendorLegalName.value,
    record.documentType,
    record.contract.fields.contractType.value,
    record.contract.fields.initialTermEndDate.value,
    record.contract.fields.renewalMechanism.value,
    record.contract.fields.noticePeriod.value,
    record.contract.computed.actionDate,
    record.contract.computed.noticeDeadline,
    record.contract.computed.status,
    record.contract.computed.reasonCode,
    record.contract.assignment.owner,
  ]);
  const deadlineRows = fixture.records.map((record) => [
    record.id,
    record.demoScenario,
    TODAY,
    record.contract.computed.exitDate,
    record.contract.computed.noticeDeadline,
    record.contract.computed.actionDate,
    record.contract.computed.daysRemaining,
    record.contract.computed.status,
    record.contract.computed.reasonCode,
    record.contract.alert?.state ?? "",
  ]);
  await Promise.all([
    writeFile(resolve(outputDirectory, "tea-23-demo-register.json"), `${JSON.stringify(fixture, null, 2)}\n`),
    writeFile(resolve(outputDirectory, "tea-23-demo-register.csv"), csv([
      ["id", "scenario", "vendor", "document_type", "contract_type", "term_end", "renewal", "notice", "action_date", "notice_deadline", "status", "reason_code", "owner"],
      ...registerRows,
    ])),
    writeFile(resolve(outputDirectory, "tea-23-deadline-matrix.csv"), csv([
      ["id", "scenario", "today", "exit_date", "notice_deadline", "action_date", "days_remaining", "status", "reason_code", "alert_state"],
      ...deadlineRows,
    ])),
  ]);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputDirectory = dirname(fileURLToPath(import.meta.url));
  await writeTea23Deliverables(outputDirectory);
}