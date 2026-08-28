import { describe, expect, it } from "vitest";
import { computeContractAlert, computeContractDates } from "./contract-computation";

const field = (value: unknown, status = "found", confidence = "high") => ({ value, status, confidence });
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
      daysRemaining: 92,
      status: "green",
      reasonCode: null,
      reason: null,
    });
  });

  it("keeps a 45-day buffer additive and counts down to the action date", () => {
    const result = computeContractDates(
      {
        ...contract(),
        assignment: { negotiationBufferDays: 45 },
      },
      new Date("2026-08-01T12:00:00Z"),
    );

    expect(result).toMatchObject({
      exitDate: "2026-12-31",
      noticeDeadline: "2026-09-30",
      actionDate: "2026-08-16",
      daysRemaining: 15,
      status: "green",
    });
  });

  it("turns amber at the action date and red after the legal deadline", () => {
    const actionDay = computeContractDates(contract(), new Date("2026-08-01T12:00:00Z"));
    const overdue = computeContractDates(contract(), new Date("2026-10-01T12:00:00Z"));
    expect(actionDay).toMatchObject({ status: "amber", daysRemaining: 0 });
    expect(overdue.status).toBe("red");
    expect(overdue.daysRemaining).toBeLessThan(0);
  });

  it("uses the Europe/Zurich calendar day around the UTC midnight boundary", () => {
    const zurichAugustFirst = new Date("2026-07-31T22:30:00.000Z");
    const computed = computeContractDates(contract(), zurichAugustFirst);
    const alert = computeContractAlert(
      computed,
      { owner: "Nina Keller", ownerEmail: "nina.keller@example.test" },
      null,
      zurichAugustFirst,
    );

    expect(computed).toMatchObject({ actionDate: "2026-08-01", daysRemaining: 0, status: "amber" });
    expect(alert?.state).toBe("due");
  });

  it("refuses to invent a date for an unknown anchor", () => {
    const result = computeContractDates(
      contract({
        noticePeriod: field({ amount: 3, unit: "months", anchor: "unknown" }),
      }),
      new Date("2026-05-01T12:00:00Z"),
    );
    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("NOTICE_ANCHOR_UNKNOWN");
    expect(result.reason).toBeNull();
    expect(result.exitDate).toBeNull();
    expect(result.noticeDeadline).toBeNull();
    expect(result.actionDate).toBeNull();
    expect(result.daysRemaining).toBeNull();
  });

  it("explains how to unblock a missing notice clause", () => {
    const result = computeContractDates(
      contract({ noticePeriod: field(null, "not_found", "low") }),
      new Date("2026-05-01T12:00:00Z"),
    );

    expect(result).toMatchObject({
      status: "blocked",
      reasonCode: "NOTICE_CLAUSE_NOT_FOUND",
      exitDate: null,
      noticeDeadline: null,
      actionDate: null,
      daysRemaining: null,
    });
    expect(result.reason).toBeNull();
  });

  it("explains when timing evidence is too poor to trust", () => {
    const result = computeContractDates(
      contract({ initialTermEndDate: field("2026-12-31", "found", "low") }),
      new Date("2026-05-01T12:00:00Z"),
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("TIMING_EVIDENCE_UNRELIABLE");
    expect(result.reason).toBeNull();
    expect(result.exitDate).toBeNull();
    expect(result.noticeDeadline).toBeNull();
    expect(result.actionDate).toBeNull();
  });

  it("explains how to resolve conflicting timing values", () => {
    const result = computeContractDates(
      contract({
        noticePeriod: field(
          { amount: 3, unit: "months", anchor: "term_end" },
          "conflicting",
        ),
      }),
      new Date("2026-05-01T12:00:00Z"),
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("TIMING_VALUES_CONFLICT");
    expect(result.reason).toBeNull();
    expect(result.noticeDeadline).toBeNull();
  });

  it("explains why an expired contract needs renewal confirmation", () => {
    const result = computeContractDates(
      contract({ renewalMechanism: field("expires") }),
      new Date("2027-01-15T12:00:00Z"),
    );

    expect(result.status).toBe("expired");
    expect(result.reasonCode).toBe("FIXED_CONTRACT_END_PASSED");
    expect(result.reason).toBeNull();
    expect(result.noticeDeadline).toBe("2026-09-30");
  });

  it("never calculates a deadline from business days even if extraction marks it found", () => {
    const result = computeContractDates(
      contract({
        noticePeriod: field({
          amount: 30,
          unit: "business_days",
          anchor: "term_end",
          purpose: "non_renewal",
        }),
      }),
      new Date("2026-05-01T12:00:00Z"),
    );

    expect(result).toMatchObject({
      status: "blocked",
      reasonCode: "NOTICE_TIMING_AMBIGUOUS",
      noticeDeadline: null,
      actionDate: null,
    });
  });

  it("advances an auto-renewing contract to its next exit date", () => {
    const result = computeContractDates(contract(), new Date("2027-01-15T12:00:00Z"));
    expect(result.exitDate).toBe("2027-12-31");
  });
});