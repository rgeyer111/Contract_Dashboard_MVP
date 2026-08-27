import { describe, expect, it } from "vitest";
import { computeContractDates } from "./contract-computation";

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

  it("refuses to invent a date for an unknown anchor", () => {
    const result = computeContractDates(
      contract({
        noticePeriod: field({ amount: 3, unit: "months", anchor: "unknown" }),
      }),
      new Date("2026-05-01T12:00:00Z"),
    );
    expect(result.status).toBe("blocked");
    expect(result.reason).toMatch(/anchor unclear/i);
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
      exitDate: null,
      noticeDeadline: null,
      actionDate: null,
      daysRemaining: null,
    });
    expect(result.reason).toMatch(/no notice clause.*add or confirm/i);
  });

  it("explains when timing evidence is too poor to trust", () => {
    const result = computeContractDates(
      contract({ initialTermEndDate: field("2026-12-31", "found", "low") }),
      new Date("2026-05-01T12:00:00Z"),
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toMatch(/scan.*uncertain.*clearer scan.*confirm/i);
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
    expect(result.reason).toMatch(/conflicting.*confirm.*controlling contract/i);
    expect(result.noticeDeadline).toBeNull();
  });

  it("explains why an expired contract needs renewal confirmation", () => {
    const result = computeContractDates(
      contract({ renewalMechanism: field("expires") }),
      new Date("2027-01-15T12:00:00Z"),
    );

    expect(result.status).toBe("expired");
    expect(result.reason).toMatch(/end date has passed.*ended or renewed/i);
    expect(result.noticeDeadline).toBe("2026-09-30");
  });

  it("advances an auto-renewing contract to its next exit date", () => {
    const result = computeContractDates(contract(), new Date("2027-01-15T12:00:00Z"));
    expect(result.exitDate).toBe("2027-12-31");
  });
});