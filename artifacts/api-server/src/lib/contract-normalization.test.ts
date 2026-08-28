import { describe, expect, it } from "vitest";
import { enforceProvenanceConsistency } from "./contract-normalization";

describe("enforceProvenanceConsistency", () => {
  it("accepts an evidence-backed ambiguous business-day notice for persistence", () => {
    const reading = {
      amount: 30,
      unit: "business_days",
      anchor: "term_end",
      purpose: "non_renewal",
    };

    expect(
      enforceProvenanceConsistency({
        fields: {
          noticePeriod: {
            value: reading,
            status: "ambiguous",
            confidence: "low",
            page: 1,
            clause: "3",
            quote: "Die Kündigung hat 30 Werktage vor Vertragsende zu erfolgen.",
            note: "Business days cannot be converted safely.",
            alternatives: [
              {
                value: reading,
                page: 1,
                clause: "3",
                quote: "Die Kündigung hat 30 Werktage vor Vertragsende zu erfolgen.",
              },
            ],
          },
        },
      }),
    ).toBe(true);
  });
});