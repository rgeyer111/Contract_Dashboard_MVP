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
  ContractTextTooLongError,
  extractContractFromText,
  extractScannedPdfText,
  normalizeExtraction,
  OcrIncompleteError,
} from "./contract-extraction";

const found = (value: unknown, page = 1, quote = "Verbatim contract evidence.") => ({
  value,
  status: "found",
  confidence: "high",
  page,
  clause: null,
  quote,
  note: null,
});

const extractedContract = {
  fields: {
    documentLanguage: found("en"),
    vendorLegalName: found("Acme Ltd."),
    contractTitle: found("Support Agreement"),
    contractType: found("maintenance"),
  },
};

const ocrText =
  "This is a complete OCR transcription of a contract with enough text to pass the readable contract threshold.";

function mockOpenAiResponse(content: unknown) {
  mocks.create.mockResolvedValueOnce({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
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
          command === "pdfinfo"
            ? "Pages:           1\n"
            : command === "find"
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
  it("returns all 18 fields and safe application assignments for an empty model response", () => {
    const result = normalizeExtraction({});

    expect(result.contract.assignment).toEqual({
      owner: "John Doe",
      negotiationBufferDays: 30,
      status: "Review Open",
    });
    expect(Object.keys(result.contract.fields)).toHaveLength(18);
    expect(Object.values(result.contract.fields).every((field) => field.status === "not_found")).toBe(
      true,
    );
    expect(result.contract.fields.noticeDeadline.note).toMatch(/computed/i);
  });

  it("rejects values that do not have complete page and quote evidence", () => {
    const result = normalizeExtraction({
      fields: {
        vendorLegalName: {
          value: "Acme Ltd.",
          status: "found",
          confidence: "high",
          page: null,
          quote: null,
        },
      },
    });

    expect(result.contract.fields.vendorLegalName).toMatchObject({
      value: null,
      status: "not_found",
      confidence: "low",
      page: null,
      quote: null,
    });
  });

  it("preserves provenance, structured notice anchors, conflicts, and contract value basis", () => {
    const result = normalizeExtraction({
      fields: {
        vendorLegalName: found(" Acme GmbH ", 2, "Acme GmbH, Berlin"),
        noticePeriod: {
          ...found(
            { amount: 3, unit: "months", anchor: "period_end_quarter", purpose: "non_renewal" },
            7,
            "mit einer Frist von drei Monaten zum Quartalsende",
          ),
          status: "conflicting",
          confidence: "medium",
          note: "The annex says two months; the body says three months.",
        },
        contractValue: found({
          amount: 240000,
          currency: "usd",
          basis: "annual",
        }),
      },
    });

    expect(result.contract.fields.vendorLegalName).toMatchObject({
      value: "Acme GmbH",
      status: "found",
      page: 2,
    });
    expect(result.contract.fields.noticePeriod).toMatchObject({
      value: {
        amount: 3,
        unit: "months",
        anchor: "period_end_quarter",
        purpose: "non_renewal",
      },
      status: "conflicting",
      page: 7,
    });
    expect(result.contract.fields.contractValue.value).toEqual({
      amount: 240000,
      currency: "USD",
      basis: "annual",
    });
  });

  it("keeps an absent notice clause explicitly not found", () => {
    const result = normalizeExtraction({
      fields: {
        noticePeriod: {
          value: null,
          status: "not_found",
          confidence: "low",
          page: null,
          clause: null,
          quote: null,
          note: null,
        },
      },
    });
    expect(result.contract.fields.noticePeriod).toEqual({
      value: null,
      status: "not_found",
      confidence: "low",
      page: null,
      clause: null,
      quote: null,
      note: null,
    });
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

  it("OCRs every page in safe batches and reports complete page coverage", async () => {
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-ocr-test");
    mocks.readFile.mockImplementation(async (pagePath: string) => Buffer.from(pagePath));
    mocks.rm.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation(
      (
        command: string,
        args: string[],
        callback: (error: null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (command === "pdfinfo") {
          callback(null, { stdout: "Pages:           12\n", stderr: "" });
          return;
        }
        if (command === "find") {
          callback(null, {
            stdout: Array.from({ length: 12 }, (_, index) =>
              `/tmp/contract-ocr-test/page-${index + 1}.png`,
            ).join("\n"),
            stderr: "",
          });
          return;
        }
        expect(command).toBe("pdftoppm");
        expect(args).toContain("-f");
        callback(null, { stdout: "", stderr: "" });
      },
    );
    for (let pageNumber = 1; pageNumber <= 12; pageNumber += 1) {
      mockOpenAiResponse({
        text: `Page ${pageNumber} has complete contract wording.`,
        confidence: pageNumber === 6 ? "Medium" : "High",
      });
    }

    const result = await extractScannedPdfText(Buffer.from("%PDF-1.7"));

    expect(result).toMatchObject({
      pageCount: 12,
      pagesProcessed: 12,
      confidence: "Medium",
    });
    expect(result.text).toContain("Page 1-1 Page 1 has complete contract wording.");
    expect(result.text).toContain("Page 6-6 Page 6 has complete contract wording.");
    expect(result.text).toContain("Page 12-12 Page 12 has complete contract wording.");
    expect(mocks.create).toHaveBeenCalledTimes(12);

    const renderCalls = mocks.execFile.mock.calls.filter(([command]) => command === "pdftoppm");
    expect(
      renderCalls.map(([, args]) => [
        args[args.indexOf("-f") + 1],
        args[args.indexOf("-l") + 1],
      ]),
    ).toEqual(Array.from({ length: 12 }, (_, index) => [`${index + 1}`, `${index + 1}`]));
    expect(mocks.readFile).toHaveBeenCalledTimes(12);
  });

  it("rejects an OCR response that reaches the model output limit", async () => {
    configureOcrRenderer();
    mocks.create.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: "length",
          message: { content: JSON.stringify({ text: ocrText, confidence: "High" }) },
        },
      ],
    });

    await expect(extractScannedPdfText(Buffer.from("%PDF-1.7"))).rejects.toBeInstanceOf(
      OcrIncompleteError,
    );
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/contract-ocr-test", {
      recursive: true,
      force: true,
    });
  });

  it("reports embedded text with no OCR confidence", async () => {
    mockOpenAiResponse(extractedContract);

    const result = await extractContractFromText(
      "This contract has embedded PDF text that can be read directly.",
      "embedded.pdf",
    );

    expect(result.extraction.source).toBe("text");
    expect(result.extraction.ocrConfidence).toBeNull();
  });

  it("uses the versioned provenance prompt without asking the model for assigned fields or deadlines", async () => {
    mockOpenAiResponse(extractedContract);
    await extractContractFromText("--- Page 1 --- Contract text with sufficient evidence.", "prompt.pdf");

    const systemPrompt = mocks.create.mock.calls[0][0].messages[0].content as string;
    expect(systemPrompt).toContain("provenance-v1");
    expect(systemPrompt).toContain("Do not return noticeDeadline");
    expect(systemPrompt).toContain("Do not extract owner");
  });

  it("passes text beyond the previous 60,000-character cutoff to field extraction", async () => {
    const finalPageMarker = "LAST PAGE: renewal notice is 90 days.";
    const completeText = `${"Contract text. ".repeat(5_000)}${finalPageMarker}`;
    mockOpenAiResponse(extractedContract);

    await extractContractFromText(completeText, "long-contract.pdf");

    expect(mocks.create.mock.calls[0][0].messages[1].content).toContain(finalPageMarker);
  });

  it("rejects text over the safe review limit without sending a partial draft", async () => {
    await expect(
      extractContractFromText("x".repeat(250_001), "oversized-contract.pdf"),
    ).rejects.toBeInstanceOf(ContractTextTooLongError);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});