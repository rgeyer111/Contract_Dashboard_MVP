import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  extractContractFromText,
  extractReadablePdfText,
} from "./contract-extraction";

const extractedFieldNames = [
  "documentType",
  "documentLanguage",
  "vendorLegalName",
  "buyerLegalEntity",
  "contractTitle",
  "contractNumber",
  "contractType",
  "signatureDate",
  "effectiveDate",
  "initialTermLength",
  "initialTermEndDate",
  "renewalMechanism",
  "renewalTermLength",
  "noticePeriod",
  "noticeDelivery",
  "contractValue",
  "billingFrequency",
] as const;

function readGermanQuarterEndContractPdf() {
  const base64 = readFileSync(
    new URL("../test-fixtures/german-quarter-end-contract.pdf.b64", import.meta.url),
    "utf8",
  );
  return Buffer.from(base64, "base64");
}

describe("German quarter-end PDF fixture", () => {
  it("parses the real PDF with page evidence and the notice wording intact", async () => {
    const text = await extractReadablePdfText(readGermanQuarterEndContractPdf());

    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("Vertragsnummer: CH-2026-009");
    expect(text).toContain("drei Monaten zum Quartalsende gekündigt");
    expect(text).toContain("CHF 120000 pro Jahr");
  });
});

describe.runIf(process.env.RUN_LIVE_CONTRACT_EXTRACTION === "1")(
  "live German contract extraction",
  () => {
    it(
      "keeps three months anchored to quarter end with complete provenance",
      async () => {
        const text = await extractReadablePdfText(readGermanQuarterEndContractPdf());
        expect(text).toContain("drei Monaten zum Quartalsende gekündigt");

        const result = await extractContractFromText(text, "german-quarter-end-contract.pdf");
        const fields = result.extraction.contract.fields;

        expect(Object.keys(fields)).toHaveLength(18);
        for (const fieldName of extractedFieldNames) {
          expect(fields[fieldName].status, fieldName).toBe("found");
          expect(fields[fieldName].confidence, fieldName).toMatch(/^(high|medium|low)$/);
          expect(fields[fieldName].page, fieldName).toBe(1);
          expect(fields[fieldName].quote, fieldName).toEqual(expect.any(String));
          expect(fields[fieldName]).toHaveProperty("clause");
        }
        expect(fields.documentLanguage.value).toBe("de");
        expect(fields.noticePeriod).toMatchObject({
          value: {
            amount: 3,
            unit: "months",
            anchor: "period_end_quarter",
            purpose: "termination_for_convenience",
          },
          status: "found",
          page: 1,
        });
        expect(fields.noticePeriod.clause).toContain("12.2");
        expect(fields.noticePeriod.quote).toContain("zum Quartalsende");
        expect(fields.noticeDeadline).toMatchObject({
          value: null,
          status: "not_found",
          page: null,
          quote: null,
        });
      },
      120_000,
    );
  },
);