import { describe, expect, it } from "vitest";
import { computeContractDates } from "./contract-computation";

const field = (value: unknown, status = "found") => ({ value, status });
const contract = (overrides: Record<string, unknown> = {}) => ({
  fields: {
    effectiveDate: field("2026-01-01"),
    initialTermLength: field({ amount: 12, unit: "months" }),
    initialTermEndDate: field("2026-12-31"),
    renewalMechanism: field("auto_renew"),
    renewalTermLength: field({ amount: 12, unit: "months" }),
    noticePeriod: field({
      amount: 3,
      unit: "months",
      anchor: "term_end",
      purpose: "non_renewal",
    }),
    ...overrides,
  },
  assignment: { negotiationBufferDays: 60 },
});

describe("computeContractDates", () => {
  it("adds the negotiation runway before the legal notice deadline", () => {
    expect(computeContractDates(contract(), new Date("2026-05-01T12:00:00Z"))).toEqual({
      exitDate: "2026-12-31",
      noticeDeadline: "2026-09-30",
      actionDate: "2026-08-01",
      status: "green",
      reason: null,
    });
  });

  it("turns amber at the action date and red after the legal deadline", () => {
    expect(computeContractDates(contract(), new Date("2026-08-01T12:00:00Z")).status).toBe("amber");
    expect(computeContractDates(contract(), new Date("2026-10-01T12:00:00Z")).status).toBe("red");
  });

  it("refuses to invent a date for an unknown anchor", () => {
    const result = computeContractDates(
      contract({
        noticePeriod: field({ amount: 3, unit: "months", anchor: "unknown" }),
      }),
      new Date("2026-05-01T12:00:00Z"),
    );
    expect(result.status).toBe("blocked");
    expect(result.reason).toMatch(/anchor unclear/i);
    expect(result.noticeDeadline).toBeNull();
  });

  it("advances an auto-renewing contract to its next exit date", () => {
    const result = computeContractDates(contract(), new Date("2027-01-15T12:00:00Z"));
    expect(result.exitDate).toBe("2027-12-31");
  });
});