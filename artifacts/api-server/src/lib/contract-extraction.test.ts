import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  execFile: vi.fn(),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: mocks.create,
      },
    },
  },
}));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: mocks.mkdtemp,
  readFile: mocks.readFile,
  rm: mocks.rm,
  writeFile: mocks.writeFile,
}));

import {
  extractContractFromText,
  extractScannedPdfText,
  normalizeExtraction,
} from "./contract-extraction";

const extractedContract = {
  contract: {
    vendor: "Acme",
    contractNumber: "AC-100",
    contractName: "Support",
    contractType: "Maintenance",
    contractValue: { status: "unknown" },
    startDate: "2026-01-01",
    contractDuration: "12 months",
    endDate: "2026-12-31",
    noticePeriod: "60 days",
    noticeDeadline: "",
    negotiationBuffer: "30 days",
  },
  confidence: {
    vendor: "High",
    contractNumber: "High",
    contractName: "High",
    contractType: "High",
    contractValue: "Low",
    startDate: "High",
    contractDuration: "High",
    endDate: "High",
    noticePeriod: "High",
    noticeDeadline: "Low",
    negotiationBuffer: "High",
  },
};

const ocrText =
  "This is a complete OCR transcription of a contract with enough text to pass the readable contract threshold.";

function mockOpenAiResponse(content: unknown) {
  mocks.create.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

function configureOcrRenderer() {
  mocks.mkdtemp.mockResolvedValue("/tmp/contract-ocr-test");
  mocks.readFile.mockResolvedValue(Buffer.from("mock PNG"));
  mocks.rm.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.execFile.mockImplementation(
    (
      command: string,
      _args: unknown[],
      callback: (error: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      callback(null, {
        stdout:
          command === "find"
            ? "/tmp/contract-ocr-test/page-1.png\n"
            : "",
        stderr: "",
      });
    },
  );
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.execFile.mockReset();
  mocks.mkdtemp.mockReset();
  mocks.readFile.mockReset();
  mocks.rm.mockReset();
  mocks.writeFile.mockReset();
});

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

describe("OCR extraction metadata", () => {
  it.each(["High", "Medium", "Low"] as const)(
    "reports OCR source and %s legibility confidence",
    async (ocrConfidence) => {
      configureOcrRenderer();
      mockOpenAiResponse({ text: ocrText, confidence: ocrConfidence });
      mockOpenAiResponse(extractedContract);

      const ocr = await extractScannedPdfText(Buffer.from("%PDF-1.7"));
      const result = await extractContractFromText(ocr.text, "scanned.pdf", {
        source: "ocr",
        ocrConfidence: ocr.confidence,
      });

      expect(result.extraction.source).toBe("ocr");
      expect(result.extraction.ocrConfidence).toBe(ocrConfidence);
    },
  );

  it("reports embedded text with no OCR confidence", async () => {
    mockOpenAiResponse(extractedContract);

    const result = await extractContractFromText(
      "This contract has embedded PDF text that can be read directly.",
      "embedded.pdf",
    );

    expect(result.extraction.source).toBe("text");
    expect(result.extraction.ocrConfidence).toBeNull();
  });
});