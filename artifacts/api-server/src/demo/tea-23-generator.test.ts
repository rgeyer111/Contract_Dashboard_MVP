import { describe, expect, it } from "vitest";
import { ListContractsResponse } from "@workspace/api-zod";
import { generateTea23Fixtures, TODAY } from "./tea-23-generator";

describe("TEA-23 deterministic fixture", () => {
  it("uses one TODAY and generates the same independent records every time", () => {
    const first = generateTea23Fixtures();
    const second = generateTea23Fixtures();
    expect(first).toEqual(second);
    expect(first.metadata.today).toBe(TODAY);
    expect(new Set(first.records.map((record) => record.id)).size).toBe(first.records.length);
    expect(() => ListContractsResponse.parse(first.records)).not.toThrow();
  });

  it("covers the representative deadline matrix", () => {
    const records = Object.fromEntries(
      generateTea23Fixtures().records.map((record) => [record.id, record]),
    );
    expect(records["tea23-quarter-end"].contract.computed).toMatchObject({
      exitDate: "2026-09-30",
      noticeDeadline: "2026-08-31",
      actionDate: "2026-08-17",
      status: "green",
    });
    expect(records["tea23-evergreen"].contract.computed).toMatchObject({
      status: "blocked",
      reasonCode: "INDEFINITE_WITHOUT_FIXED_ANCHOR",
    });
    expect(records["tea23-conflicting-timing"].contract.computed).toMatchObject({
      status: "blocked",
      reasonCode: "TIMING_VALUES_CONFLICT",
    });
    expect(records["tea23-unknown-anchor"].contract.computed).toMatchObject({
      status: "blocked",
      reasonCode: "NOTICE_ANCHOR_UNKNOWN",
    });
    expect(records["tea23-expired"].contract.computed).toMatchObject({
      status: "expired",
      reasonCode: "FIXED_CONTRACT_END_PASSED",
    });
    expect(records["tea23-blocked"].contract.computed).toMatchObject({
      status: "blocked",
      reasonCode: "CONTRACT_END_UNESTABLISHED",
    });
    expect(records["tea23-overdue"].contract.computed.status).toBe("red");
    expect(records["tea23-overdue"].contract.alert?.state).toBe("overdue");
  });

  it("uses Swiss companies, people, cantons, and CHF without imposing validation rules", () => {
    const fixture = generateTea23Fixtures();

    expect(fixture.records.every((record) => record.contract.fields.contractValue.value.currency === "CHF")).toBe(true);
    expect(fixture.records.every((record) => record.contract.fields.documentLanguage.value === "de")).toBe(true);
    expect(fixture.records.every((record) => record.contract.fields.buyerLegalEntity.value === "Alpenblick Industrie AG")).toBe(true);
    expect(fixture.records.map((record) => record.contract.assignment.owner)).toEqual([
      "Nina Keller",
      "Lukas Meier",
      "Sabrina Schmid",
      "Anaïs Rochat",
      "Mathieu Girard",
      "Simon Aebischer",
      "Giulia Bernasconi",
    ]);
    expect(fixture.records.map((record) => record.demoScenario)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Zürich"),
        expect.stringContaining("Basel-Stadt"),
        expect.stringContaining("Bern"),
        expect.stringContaining("Tessin"),
      ]),
    );
  });
});