import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  extractContractFromText,
  extractPdfTextWithRecovery,
  extractScannedPdfText,
} from "../src/lib/contract-extraction";

const fieldNames = [
  ["document_type", "documentType"],
  ["document_language", "documentLanguage"],
  ["vendor_legal_name", "vendorLegalName"],
  ["buyer_legal_entity", "buyerLegalEntity"],
  ["contract_title", "contractTitle"],
  ["contract_number", "contractNumber"],
  ["contract_type", "contractType"],
  ["signature_date", "signatureDate"],
  ["effective_date", "effectiveDate"],
  ["initial_term_length", "initialTermLength"],
  ["initial_term_end_date", "initialTermEndDate"],
  ["renewal_mechanism", "renewalMechanism"],
  ["renewal_term_length", "renewalTermLength"],
  ["notice_period", "noticePeriod"],
  ["notice_delivery", "noticeDelivery"],
  ["contract_value", "contractValue"],
  ["billing_frequency", "billingFrequency"],
] as const;

type GroundTruth = {
  documents: Array<{
    document_id: string;
    source_filename: string;
    difficulty_tier: string;
    has_text_layer: boolean;
    fields: Record<string, { status: string; value: unknown }>;
  }>;
};

function comparableValue(field: string, value: unknown): unknown {
  if (field !== "notice_period") return value;
  const values = Array.isArray(value) ? value : value === null ? null : [value];
  return values?.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const { source: _source, ...candidate } = item as Record<string, unknown>;
    return candidate;
  }) ?? null;
}

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
    return [candidate.value];
  });
  const expectedCandidates = comparableValue("notice_period", expectedValue);
  return Array.isArray(expectedCandidates) &&
    expectedCandidates.every((expected) =>
      validAlternatives.some(
        (actual) =>
          JSON.stringify(comparableValue("notice_period", actual)) ===
          JSON.stringify(comparableValue("notice_period", expected)),
      ),
    );
}

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const sourceDirectory = process.argv[2];
const outputPath = process.argv[3];
const disagreementsPath = process.argv[4];
const reportPath = process.argv[5];
if (!sourceDirectory || !outputPath) {
  throw new Error(
    "Usage: tsx run-tea-31.ts <validation-directory> <output-json> [disagreements-csv] [report-md]",
  );
}

const groundTruth = JSON.parse(
  await readFile(join(sourceDirectory, "ground_truth.json"), "utf8"),
) as GroundTruth;
const results = [];
const selectedDocumentIds = new Set(
  (process.env.TEA31_DOCUMENT_IDS ?? "").split(",").filter(Boolean),
);

for (const document of groundTruth.documents) {
  if (selectedDocumentIds.size > 0 && !selectedDocumentIds.has(document.document_id)) continue;
  console.error(`Evaluating ${document.document_id} ${document.source_filename}`);
  const sourcePath = join(sourceDirectory, document.source_filename);
  const pdf = await readFile(sourcePath);
  const textResult = document.has_text_layer
    ? { text: (await extractPdfTextWithRecovery(pdf)).text, source: "text" as const }
    : { ...(await extractScannedPdfText(pdf)), source: "ocr" as const };
  const extraction = await extractContractFromText(textResult.text, document.source_filename, {
    source: textResult.source,
    ocrConfidence: "confidence" in textResult ? textResult.confidence : undefined,
    ocrPageCount: "pageCount" in textResult ? textResult.pageCount : undefined,
    ocrPagesProcessed: "pagesProcessed" in textResult ? textResult.pagesProcessed : undefined,
  });
  const fields = extraction.extraction.contract.fields as Record<
    string,
    { status: string; value: unknown; alternatives?: unknown[] }
  >;
  const comparisons = fieldNames.map(([groundTruthName, extractedName]) => {
    const expected = document.fields[groundTruthName];
    const actual = fields[extractedName];
    const actualAlternatives = actual.alternatives ?? [];
    const valuesMatch =
      JSON.stringify(comparableValue(groundTruthName, expected.value)) ===
      JSON.stringify(comparableValue(groundTruthName, actual.value));
    const evidenceMatches = groundTruthName !== "notice_period" ||
      hasRequiredUncertaintyEvidence(
        expected.status,
        expected.value,
        actualAlternatives,
        textResult.text,
      );
    return {
      field: groundTruthName,
      expected_status: expected.status,
      actual_status: actual.status,
      expected_value: expected.value,
      actual_value: actual.value,
      actual_alternatives: actualAlternatives,
      evidence_matches: evidenceMatches,
      exact: expected.status === actual.status && valuesMatch && evidenceMatches,
    };
  });
  results.push({
    document_id: document.document_id,
    filename: document.source_filename,
    difficulty: document.difficulty_tier,
    source: textResult.source,
    exact: comparisons.filter((comparison) => comparison.exact).length,
    comparisons,
  });
}

await writeFile(outputPath, JSON.stringify(results, null, 2));

const disagreements = results.flatMap((document) =>
  document.comparisons
    .filter((comparison) => !comparison.exact)
    .map((comparison) => ({ document, comparison })),
);
if (disagreementsPath) {
  const rows = [
    ["document_id", "filename", "field", "expected_status", "actual_status", "expected_value", "actual_value"]
      .map(csvCell)
      .join(","),
    ...disagreements.map(({ document, comparison }) =>
      [
        document.document_id,
        document.filename,
        comparison.field,
        comparison.expected_status,
        comparison.actual_status,
        comparison.expected_value,
        comparison.actual_value,
      ].map(csvCell).join(","),
    ),
  ];
  await writeFile(disagreementsPath, `${rows.join("\n")}\n`);
}

if (reportPath) {
  const agreements = results.reduce((sum, document) => sum + document.exact, 0);
  const fieldCounts = Object.entries(
    disagreements.reduce<Record<string, number>>((counts, { comparison }) => {
      counts[comparison.field] = (counts[comparison.field] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort((left, right) => right[1] - left[1]);
  const title = (value: string) =>
    value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date());
  const targetNotice = (documentId: string) =>
    results
      .find((document) => document.document_id === documentId)
      ?.comparisons.find((comparison) => comparison.field === "notice_period");
  const d05Resolved = targetNotice("D05")?.exact === true;
  const d09Resolved = targetNotice("D09")?.exact === true;
  const report = `# TEA-31 contract extraction evaluation

Run date: ${date}

## Method

Each public validation PDF was processed through the production extraction implementation. Text-layer PDFs used the shared embedded-text recovery policy, which normalizes only a temporary working copy when the original parser fails. OCR documents used the production OCR path.

Notice-period comparison treats a singleton object and one-item array equally and excludes the ground-truth-only \`source\` hint. Ambiguous and conflicting notice results count as exact only when every expected typed candidate has a positive page number and a verbatim quote present in the extracted source text.

## Result

- Documents processed: **${results.length} / ${groundTruth.documents.length}**
- Field checks: **${results.length * fieldNames.length}**
- Exact agreements: **${agreements}**
- Exact agreement rate: **${((agreements / (results.length * fieldNames.length)) * 100).toFixed(1)}%**
- Disagreements: **${disagreements.length}**

## Exact agreement by document

| ID | Difficulty | Source | Exact fields |
| --- | --- | --- | ---: |
${results.map((document) => `| ${document.document_id} | ${title(document.difficulty)} | ${document.source === "ocr" ? "OCR" : "Text"} | ${document.exact} / ${fieldNames.length} |`).join("\n")}

## Disagreements by field

| Field | Count |
| --- | ---: |
${fieldCounts.map(([field, count]) => `| ${title(field)} | ${count} |`).join("\n")}

The complete expected-versus-actual disagreement list is in \`tea-31-disagreements.csv\`.

## High-risk notice findings

- ${d05Resolved ? "**Resolved:**" : "**Unresolved:**"} D05 ${d05Resolved ? "returns" : "must return"} \`conflicting\` with both candidate periods and source-backed alternatives.
- ${d09Resolved ? "**Resolved:**" : "**Unresolved:**"} D09 ${d09Resolved ? "returns" : "must return"} \`ambiguous\` with the business-day period and source-backed evidence.
`;
  await writeFile(reportPath, report);
}