import { describe, expect, it } from "vitest";
import { normalizeExtraction } from "./contract-extraction";

describe("normalizeExtraction", () => {
  it("fills missing AI fields with safe defaults", () => {
    const result = normalizeExtraction({});

    expect(result.contract).toMatchObject({
      vendor: "",
      contractType: "",
      contractValue: { status: "unknown", amount: null, currency: null },
      owner: "John Doe",
      status: "Review Open",
    });
    expect(Object.values(result.confidence)).toEqual(
      expect.arrayContaining(["Low"]),
    );
    expect(Object.keys(result.confidence)).toHaveLength(13);
  });

  it("rejects malformed types, values, currencies, and confidence labels", () => {
    const result = normalizeExtraction({
      contract: {
        vendor: 42,
        contractType: "Unsupported",
        contractValue: {
          status: "stated",
          amount: "240000",
          currency: "US dollars",
        },
      },
      confidence: { vendor: "Certain", contractType: "High" },
    });

    expect(result.contract.vendor).toBe("");
    expect(result.contract.contractType).toBe("");
    expect(result.contract.contractValue).toEqual({
      status: "unknown",
      amount: null,
      currency: null,
    });
    expect(result.confidence.vendor).toBe("Low");
    expect(result.confidence.contractType).toBe("High");
  });

  it("preserves a valid structured extraction", () => {
    const result = normalizeExtraction({
      contract: {
        vendor: " Acme ",
        contractNumber: "AC-100",
        contractName: "Support",
        contractType: "Maintenance",
        contractValue: { status: "stated", amount: 240000, currency: "usd" },
        startDate: "2026-01-01",
        contractDuration: "12 months",
        endDate: "2026-12-31",
        noticePeriod: "60 days",
        noticeDeadline: "2026-11-01",
        negotiationBuffer: "30 days",
      },
      confidence: {
        vendor: "High",
        contractNumber: "Medium",
        contractName: "High",
        contractType: "High",
        contractValue: "High",
        startDate: "High",
        contractDuration: "Medium",
        endDate: "High",
        noticePeriod: "Medium",
        noticeDeadline: "Low",
        negotiationBuffer: "Medium",
      },
    });

    expect(result.contract.vendor).toBe("Acme");
    expect(result.contract.contractValue).toEqual({
      status: "stated",
      amount: 240000,
      currency: "USD",
    });
    expect(result.confidence.noticeDeadline).toBe("Low");
  });
});