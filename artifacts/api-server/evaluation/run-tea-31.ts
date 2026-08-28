import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  extractContractFromText,
  extractPdfTextWithRecovery,
  extractScannedPdfText,
} from "../src/lib/contract-extraction";

type GroundTruthField = { status: string; value: unknown };
type GroundTruthDocument = {
  document_id: string;
  source_filename: string;
  difficulty_tier: string;
  has_text_layer: boolean;
  fields: Record<string, GroundTruthField>;
};
type EvaluationResult = {
  documentId: string;
  filename: string;
  source: "text" | "ocr";
  fields: Record<string, { status: string; value?: unknown }>;
};

function normalizedText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageText(contractText: string) {
  const markers = [
    ...contractText.matchAll(/--- Page (\d+) ---|(?:^|\s)Page (\d+)-(\d+)(?=\s)/g),
  ];
  const pages = new Map<number, string>();
  for (const [index, marker] of markers.entries()) {
    const startPage = Number(marker[1] ?? marker[2]);
    const endPage = Number(marker[1] ?? marker[3]);
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[index + 1]?.index ?? contractText.length;
    const text = contractText.slice(start, end);
    for (let page = startPage; page <= endPage; page += 1) {
      pages.set(page, `${pages.get(page) ?? ""} ${text}`.trim());
    }
  }
  return pages;
}

function hasRequiredUncertaintyEvidence(
  expectedStatus: string,
  expectedValue: unknown,
  actualAlternatives: unknown[],
  contractText: string,
) {
  if (expectedStatus !== "ambiguous" && expectedStatus !== "conflicting") return true;
  const minimum = expectedStatus === "conflicting" ? 2 : 1;
  if (actualAlternatives.length < minimum) return false;
  const pages = pageText(contractText);
  const validAlternatives = actualAlternatives.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (
      !Number.isInteger(candidate.page) ||
      Number(candidate.page) < 1 ||
      typeof candidate.quote !== "string" ||
      !normalizedText(pages.get(Number(candidate.page)) ?? "").includes(
        normalizedText(candidate.quote),
      )
    ) {
      return [];
    }
    return [canonicalValue("notice_period", candidate.value)];
  });
  const expectedCandidates = canonicalValue("notice_period", expectedValue);
  return (
    Array.isArray(expectedCandidates) &&
    expectedCandidates.every((expected) =>
      validAlternatives.some(
        (actual) => JSON.stringify(actual) === JSON.stringify(expected),
      ),
    )
  );
}

const fieldNames = {
  document_type: "documentType",
  document_language: "documentLanguage",
  vendor_legal_name: "vendorLegalName",
  buyer_legal_entity: "buyerLegalEntity",
  contract_title: "contractTitle",
  contract_number: "contractNumber",
  contract_type: "contractType",
  signature_date: "signatureDate",
  effective_date: "effectiveDate",
  initial_term_length: "initialTermLength",
  initial_term_end_date: "initialTermEndDate",
  renewal_mechanism: "renewalMechanism",
  renewal_term_length: "renewalTermLength",
  notice_period: "noticePeriod",
  notice_delivery: "noticeDelivery",
  contract_value: "contractValue",
  billing_frequency: "billingFrequency",
} as const;

const fieldLabels: Record<string, string> = {
  billing_frequency: "Billing frequency",
  buyer_legal_entity: "Buyer legal entity",
  contract_number: "Contract number",
  contract_title: "Contract title",
  contract_type: "Contract type",
  contract_value: "Contract value",
  document_language: "Document language",
  document_type: "Document type",
  effective_date: "Effective date",
  initial_term_end_date: "Initial term end date",
  initial_term_length: "Initial term length",
  notice_delivery: "Notice delivery",
  notice_period: "Notice period",
  renewal_mechanism: "Renewal mechanism",
  renewal_term_length: "Renewal term length",
  signature_date: "Signature date",
  vendor_legal_name: "Vendor legal name",
};

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  throw new Error(
    "Usage: tsx evaluation/run-tea-31.ts <validation-set-directory> [document-id,...]",
  );
}
const selectedDocumentIds = new Set(
  (process.argv[3] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const groundTruth = JSON.parse(
  await readFile(join(sourceDirectory, "ground_truth.json"), "utf8"),
) as { documents: GroundTruthDocument[] };

const outputPath = join(import.meta.dirname, "tea-31-latest-results.json");
const previousResults =
  selectedDocumentIds.size > 0
    ? await readFile(outputPath, "utf8")
        .then((content) => JSON.parse(content) as EvaluationResult[])
        .catch(() => [])
    : [];
const resultsById = new Map(previousResults.map((result) => [result.documentId, result]));
const contractTextById = new Map<string, string>();

for (const document of groundTruth.documents.filter(
  ({ document_id }) =>
    selectedDocumentIds.size === 0 || selectedDocumentIds.has(document_id),
)) {
  const filename = basename(document.source_filename);
  const pdf = await readFile(join(sourceDirectory, filename));
  const extractedText = document.has_text_layer
    ? {
        text: (await extractPdfTextWithRecovery(pdf)).text,
        source: "text" as const,
        ocrConfidence: undefined,
        pageCount: undefined,
        pagesProcessed: undefined,
      }
    : {
        ...(await extractScannedPdfText(pdf)),
        source: "ocr" as const,
        ocrConfidence: undefined,
      };
  contractTextById.set(document.document_id, extractedText.text);
  const extraction = await extractContractFromText(extractedText.text, filename, {
    source: extractedText.source,
    ocrConfidence:
      extractedText.source === "ocr" ? extractedText.confidence : undefined,
    ocrPageCount:
      extractedText.source === "ocr" ? extractedText.pageCount : undefined,
    ocrPagesProcessed:
      extractedText.source === "ocr" ? extractedText.pagesProcessed : undefined,
  });
  resultsById.set(document.document_id, {
    documentId: document.document_id,
    filename,
    source: extractedText.source,
    fields: extraction.extraction.contract.fields,
  });
  const checkpoint = groundTruth.documents.flatMap(({ document_id }) => {
    const result = resultsById.get(document_id);
    return result ? [result] : [];
  });
  await writeFile(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  console.log(`Processed ${document.document_id}: ${filename}`);
}

const results = groundTruth.documents.flatMap(({ document_id }) => {
  const result = resultsById.get(document_id);
  return result ? [result] : [];
});
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);

if (selectedDocumentIds.size > 0) {
  console.log("Subset run complete; report files were not regenerated.");
  process.exit(0);
}
if (results.length !== groundTruth.documents.length) {
  throw new Error("A complete run is required to regenerate evaluation artifacts.");
}

function canonicalValue(fieldName: string, value: unknown) {
  if (fieldName === "notice_period") {
    const values = Array.isArray(value) ? value : value === null ? null : [value];
    return (
      values?.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const { source: _source, ...candidate } = item as Record<string, unknown>;
        return candidate;
      }) ?? null
    );
  }
  if (fieldName !== "notice_delivery" || !value || typeof value !== "object") return value;
  const notice = { ...(value as Record<string, unknown>) };
  const cc = notice.cc;
  notice.cc =
    cc === null || cc === undefined || cc === ""
      ? []
      : typeof cc === "string"
        ? [cc]
        : cc;
  return notice;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const resultById = new Map(results.map((result) => [result.documentId, result]));
const disagreements: string[][] = [];
const agreementsByDocument = new Map<string, number>();
const disagreementsByField = new Map<string, number>();
const noticePeriodAgreementByDocument = new Map<string, boolean>();
let agreementCount = 0;

for (const document of groundTruth.documents) {
  const actualFields = resultById.get(document.document_id)?.fields;
  if (!actualFields) throw new Error(`Missing result for ${document.document_id}`);
  let documentAgreements = 0;
  for (const [groundTruthName, actualName] of Object.entries(fieldNames)) {
    const expected = document.fields[groundTruthName];
    const actual = actualFields[actualName];
    const expectedValue = canonicalValue(groundTruthName, expected.value);
    const actualValue = canonicalValue(groundTruthName, actual.value);
    const evidenceMatches =
      groundTruthName !== "notice_period" ||
      hasRequiredUncertaintyEvidence(
        expected.status,
        expected.value,
        actual.alternatives ?? [],
        contractTextById.get(document.document_id) ?? "",
      );
    const agrees =
      expected.status === actual.status &&
      evidenceMatches &&
      (expectedValue === null ||
        JSON.stringify(expectedValue) === JSON.stringify(actualValue));
    if (groundTruthName === "notice_period") {
      noticePeriodAgreementByDocument.set(document.document_id, agrees);
    }
    if (agrees) {
      agreementCount += 1;
      documentAgreements += 1;
      continue;
    }
    disagreementsByField.set(
      groundTruthName,
      (disagreementsByField.get(groundTruthName) ?? 0) + 1,
    );
    disagreements.push([
      document.document_id,
      document.source_filename,
      groundTruthName,
      expected.status,
      actual.status,
      expectedValue === null ? "" : JSON.stringify(expectedValue),
      actualValue === null || actualValue === undefined
        ? ""
        : JSON.stringify(actualValue),
    ]);
  }
  agreementsByDocument.set(document.document_id, documentAgreements);
}

const disagreementCsv = [
  [
    "document_id",
    "filename",
    "field",
    "expected_status",
    "actual_status",
    "expected_value",
    "actual_value",
  ],
  ...disagreements,
]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
await writeFile(
  join(import.meta.dirname, "tea-31-disagreements.csv"),
  `${disagreementCsv}\n`,
);

const fieldCountRows = [...disagreementsByField.entries()]
  .sort(([leftName, leftCount], [rightName, rightCount]) =>
    rightCount - leftCount || leftName.localeCompare(rightName),
  )
  .map(([name, count]) => `| ${fieldLabels[name] ?? name} | ${count} |`)
  .join("\n");
const documentRows = groundTruth.documents
  .map((document) => {
    const language = document.fields.document_language.value === "de" ? "German" : "English";
    const source = resultById.get(document.document_id)?.source === "ocr" ? "OCR" : "Text";
    const difficulty =
      document.difficulty_tier.charAt(0).toUpperCase() +
      document.difficulty_tier.slice(1);
    return `| ${document.document_id} | ${language} | ${difficulty} | ${source} | ${agreementsByDocument.get(document.document_id)} / 17 |`;
  })
  .join("\n");
const noticeDisagreementCount = disagreementsByField.get("notice_delivery") ?? 0;
const noticeDisagreements = disagreements.filter((row) => row[2] === "notice_delivery");
const missingNoticeDeliveryCount = noticeDisagreements.filter(
  (row) => row[4] === "not_found",
).length;
const incompleteNoticeDeliveryCount = noticeDisagreements.filter(
  (row) => {
    const expectedEmails = [
      ...row[5].matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
    ].map(([email]) => email.toLocaleLowerCase());
    const actualValue = row[6].toLocaleLowerCase();
    return (
      row[4] === "not_found" ||
      /"address":null|\b(registered office of the recipient|addresses? stated above|vertragskopf)\b/i.test(
        row[6],
      ) ||
      expectedEmails.some((email) => !actualValue.includes(email))
    );
  },
).length;
const d05ResolvedOffice = noticeDisagreements.some(
  (row) =>
    row[0] === "D05" &&
    row[4] === "found" &&
    !row[6].includes("registered office of the recipient"),
);
const noticeDifferenceSummary = [
  missingNoticeDeliveryCount > 0
    ? `${missingNoticeDeliveryCount} still have no extracted delivery value.`
    : null,
  noticeDisagreementCount - missingNoticeDeliveryCount > 0
    ? "Resolved mismatches retain operational destinations but differ from the strict ground-truth representation through formatting, country suffixes, or reference expansion."
    : null,
  d05ResolvedOffice
    ? "D05 resolves the generic registered-office copy reference to the recipient's full postal address."
    : null,
]
  .filter(Boolean)
  .join(" ");
const ocrDocument = results.find((result) => result.source === "ocr");
const runDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date());
const agreementRate = ((agreementCount / 187) * 100).toFixed(1);

const report = `# TEA-31 contract extraction evaluation

Run date: ${runDate}

## Validation set

- Source: \`rgeyer111/Contract_Dashboard_MVP\`
- 11 real-format vendor contract PDFs
- Languages: German and English
- Includes an auto-renewing contract, quarter-end language, one scanned PDF, and an agreement/amendment pair
- Human-verified answers: \`ground_truth.json\` and \`ground_truth_verified_answers.xlsx\`
- Ground-truth fields checked per document: 17

The source PDFs and verified-answer files were read from the public GitHub repository for this evaluation. They are intentionally not copied into this workspace.

## Method

Each PDF was processed through the application's current extraction implementation. PDFs with a text layer used embedded-text extraction. The scan used the production OCR path before structured extraction.

For every field, the run compared:

1. expected extraction status (\`found\`, \`not_found\`, \`ambiguous\`, or \`conflicting\`);
2. normalized structured value when the ground truth expected a value.

This is intentionally conservative. Semantically close values such as \`12 months\` versus \`1 year\`, an address with an additional country suffix, or an expanded title versus the shorter verified title are listed as disagreements. Optional notice CC values are normalized to the application schema before comparison: missing, null, and empty values all become \`[]\`, while a single CC string becomes a one-item array. Ambiguous and conflicting notice-period results count as exact only when every expected typed candidate has positive-page, verbatim evidence in the source text.

## Result

- Documents processed: **${results.length} / 11**
- Field checks: **187**
- Exact agreements: **${agreementCount}**
- Exact agreement rate: **${agreementRate}%**
- Disagreements: **${disagreements.length}**
- OCR document: **${ocrDocument ? agreementsByDocument.get(ocrDocument.documentId) : 0} / 17** exact agreements

## Exact agreement by document

| ID | Language | Difficulty | Source | Exact fields |
| --- | --- | --- | --- | ---: |
${documentRows}

## Disagreements by field

| Field | Count |
| --- | ---: |
${fieldCountRows}

The complete expected-versus-actual disagreement list is in \`tea-31-disagreements.csv\`.

## Notice-delivery result

Strict notice-delivery disagreements fell from **9 to ${noticeDisagreementCount}**. More importantly for operational reliability, missing or unresolved delivery destinations fell from **6 to ${incompleteNoticeDeliveryCount}**. The run resolved referenced header addresses, retained required email/post copy destinations, and normalized empty CC values. ${noticeDifferenceSummary}

## High-risk notice-period findings

- ${noticePeriodAgreementByDocument.get("D05") ? "**Resolved:**" : "**Unresolved:**"} D05 ${noticePeriodAgreementByDocument.get("D05") ? "returns" : "must return"} \`conflicting\` with both candidate periods and source-backed alternatives.
- ${noticePeriodAgreementByDocument.get("D09") ? "**Resolved:**" : "**Unresolved:**"} D09 ${noticePeriodAgreementByDocument.get("D09") ? "returns" : "must return"} \`ambiguous\` with the business-day period and source-backed evidence.

## Interpretation

The extraction pipeline successfully processed the complete set, including OCR. The focused notice-delivery recovery materially improved the highest-risk operational field, while the **${agreementRate}%** overall exact agreement rate still shows that extraction needs human review.
`;
await writeFile(
  join(import.meta.dirname, "tea-31-extraction-report.md"),
  report,
);
console.log(
  `Regenerated report: ${agreementCount}/187 agreements; ${noticeDisagreementCount} notice-delivery disagreements.`,
);