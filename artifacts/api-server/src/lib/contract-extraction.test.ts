import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  execFile: vi.fn(),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  parsePdf: vi.fn(),
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
  stat: mocks.stat,
  writeFile: mocks.writeFile,
}));

vi.mock("pdf-parse", () => ({
  default: mocks.parsePdf,
}));

import {
  ContractTextTooLongError,
  extractContractFromText,
  extractPdfTextWithRecovery,
  extractScannedPdfText,
  normalizeExtraction,
  OcrIncompleteError,
  PdfRecoveryError,
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

const missingNoticeAudit = {
  noticePeriod: {
    value: null,
    status: "not_found",
    confidence: "low",
    page: null,
    clause: null,
    quote: null,
    note: null,
    alternatives: [],
  },
};

function mockOpenAiResponse(content: unknown, options: { queueNoticeAudit?: boolean } = {}) {
  mocks.create.mockResolvedValueOnce({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
  });
  if (
    options.queueNoticeAudit !== false &&
    content &&
    typeof content === "object" &&
    "fields" in content
  ) {
    mocks.create.mockResolvedValueOnce({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(missingNoticeAudit) } },
      ],
    });
  }
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
  mocks.stat.mockReset();
  mocks.stat.mockResolvedValue({ size: 1024 });
  mocks.writeFile.mockReset();
  mocks.parsePdf.mockReset();
});

describe("normalizeExtraction", () => {
  it("returns all 18 fields and safe application assignments for an empty model response", () => {
    const result = normalizeExtraction({});

    expect(result.contract.assignment).toEqual({
      owner: "John Doe",
      ownerEmail: "john.doe@example.com",
      negotiationBufferDays: 30,
      negotiationBufferSource: "global_default",
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
          alternatives: [
            {
              value: { amount: 2, unit: "months", anchor: "period_end_quarter", purpose: "non_renewal" },
              page: 9,
              clause: "Annex 2",
              quote: "mit einer Frist von zwei Monaten zum Quartalsende",
            },
            {
              value: { amount: 3, unit: "months", anchor: "period_end_quarter", purpose: "non_renewal" },
              page: 7,
              clause: "8.2",
              quote: "mit einer Frist von drei Monaten zum Quartalsende",
            },
          ],
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
      alternatives: [
        expect.objectContaining({ page: 9, quote: expect.stringContaining("zwei Monaten") }),
        expect.objectContaining({ page: 7, quote: expect.stringContaining("drei Monaten") }),
      ],
    });
    expect(result.contract.fields.contractValue.value).toEqual({
      amount: 240000,
      currency: "USD",
      basis: "annual",
    });
  });

  it("preserves integrated body and annex notice conflicts instead of collapsing them", () => {
    const body = {
      amount: 3,
      unit: "months",
      anchor: "term_end",
      purpose: "non_renewal",
    };
    const annex = {
      amount: 6,
      unit: "months",
      anchor: "term_end",
      purpose: "non_renewal",
    };
    const result = normalizeExtraction({
      fields: {
        noticePeriod: {
          ...found(
            [body, annex],
            1,
            "Either party may give written notice of non-renewal not less than three months prior to term end.",
          ),
          status: "conflicting",
          confidence: "high",
          note: "The integrated annex requires six months while the body requires three months.",
          alternatives: [
            {
              value: body,
              page: 1,
              clause: "11.2",
              quote: "notice of non-renewal not less than three months prior to term end",
            },
            {
              value: annex,
              page: 2,
              clause: "Annex C.4",
              quote: "notice of non-renewal no later than six months prior to term end",
            },
          ],
        },
      },
    });

    expect(result.contract.fields.noticePeriod).toMatchObject({
      value: [body, annex],
      status: "conflicting",
      alternatives: [
        expect.objectContaining({ value: body, clause: "11.2" }),
        expect.objectContaining({ value: annex, clause: "Annex C.4" }),
      ],
    });
  });

  it("recovers a notice conflict from complete alternatives when the primary value is unusable", () => {
    const body = {
      amount: 3,
      unit: "months",
      anchor: "term_end",
      purpose: "non_renewal",
    };
    const annex = {
      amount: 6,
      unit: "months",
      anchor: "term_end",
      purpose: "non_renewal",
    };
    const result = normalizeExtraction({
      fields: {
        noticePeriod: {
          value: null,
          status: "conflicting",
          confidence: "high",
          page: null,
          clause: null,
          quote: null,
          note: "The integrated body and annex specify incompatible notice periods.",
          alternatives: [
            {
              value: body,
              page: 1,
              clause: "11.2",
              quote: "notice of non-renewal not less than three months prior to term end",
            },
            {
              value: annex,
              page: 2,
              clause: "Annex C.4",
              quote: "notice of non-renewal no later than six months prior to term end",
            },
          ],
        },
      },
    });

    expect(result.contract.fields.noticePeriod).toMatchObject({
      value: [body, annex],
      status: "conflicting",
      page: 1,
      clause: "11.2",
      alternatives: [
        expect.objectContaining({ value: body }),
        expect.objectContaining({ value: annex }),
      ],
    });
  });

  it("preserves literal business-day notices as ambiguous and never converts them", () => {
    const result = normalizeExtraction({
      fields: {
        initialTermEndDate: found("2026-12-31"),
        noticePeriod: {
          ...found(
            {
              amount: 30,
              unit: "business_days",
              anchor: "term_end",
              purpose: "non_renewal",
            },
            1,
            "Die Kündigung hat spätestens 30 Werktage vor Ablauf zu erfolgen.",
          ),
          status: "ambiguous",
          confidence: "high",
          note: "Werktage cannot be safely converted to calendar days.",
          alternatives: [],
        },
      },
    });

    expect(result.contract.fields.noticePeriod).toMatchObject({
      value: {
        amount: 30,
        unit: "business_days",
        anchor: "term_end",
        purpose: "non_renewal",
      },
      status: "ambiguous",
      confidence: "medium",
    });
    expect(result.contract.computed).toMatchObject({
      status: "blocked",
      reasonCode: "NOTICE_TIMING_AMBIGUOUS",
      noticeDeadline: null,
    });
  });

  it("turns a business-day notice marked found into a safe ambiguity", () => {
    const result = normalizeExtraction({
      fields: {
        noticePeriod: found({
          amount: 10,
          unit: "business_days",
          anchor: "term_end",
          purpose: "non_renewal",
        }),
      },
    });

    expect(result.contract.fields.noticePeriod).toMatchObject({
      status: "ambiguous",
      confidence: "medium",
      note: expect.stringMatching(/cannot be safely converted/i),
    });
  });

  it("rejects a competing reading that does not match the field type", () => {
    const result = normalizeExtraction({
      fields: {
        contractType: {
          ...found("maintenance", 2, "Maintenance agreement."),
          status: "ambiguous",
          confidence: "low",
          note: "Two possible categories.",
          alternatives: [
            { value: "maintenance", page: 2, clause: null, quote: "Maintenance agreement." },
            { value: { invalid: true }, page: 3, clause: null, quote: "Software services." },
          ],
        },
      },
    });

    expect(result.contract.fields.contractType).toMatchObject({
      value: null,
      status: "not_found",
      note: "A competing reading did not match the required field type.",
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
      alternatives: [],
    });
  });
});

describe("embedded PDF text recovery", () => {
  it("normalizes a temporary copy, retries embedded text, and cleans up", async () => {
    const original = Buffer.from("%PDF-1.4 malformed xref");
    const repaired = Buffer.from("%PDF-1.7 repaired");
    mocks.parsePdf
      .mockRejectedValueOnce(new Error("bad XRef entry"))
      .mockResolvedValueOnce({
        text: "--- Page 1 ---\nRecovered contract wording with enough readable text.",
      });
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-pdf-repair-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(repaired);
    mocks.rm.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation(
      (...call: unknown[]) => {
        const args = call[1] as string[];
        const callback = call.at(-1) as (
          error: null,
          result: { stdout: string; stderr: string },
        ) => void;
        callback(null, {
          stdout: args.includes("pdfinfo") ? "Pages: 1\nEncrypted: no\n" : "",
          stderr: "",
        });
      },
    );

    const result = await extractPdfTextWithRecovery(original);

    expect(result).toEqual({
      text: "--- Page 1 ---\nRecovered contract wording with enough readable text.",
      repaired: true,
    });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/tmp/contract-pdf-repair-test/original.pdf",
      original,
    );
    expect(mocks.execFile).toHaveBeenCalledWith(
      "prlimit",
      [
        "--fsize=52428800",
        "--as=536870912",
        "--cpu=15",
        "--",
        "pdftocairo",
        "-pdf",
        "/tmp/contract-pdf-repair-test/original.pdf",
        "/tmp/contract-pdf-repair-test/repaired.pdf",
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
      expect.any(Function),
    );
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/contract-pdf-repair-test", {
      recursive: true,
      force: true,
    });
  });

  it("rejects encrypted PDFs before repair and cleans the working directory", async () => {
    mocks.parsePdf.mockRejectedValueOnce(new Error("bad XRef entry"));
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-pdf-repair-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation(
      (...call: unknown[]) => {
        const callback = call.at(-1) as (
          error: null,
          result: { stdout: string; stderr: string },
        ) => void;
        callback(null, { stdout: "Pages: 1\nEncrypted: yes\n", stderr: "" });
      },
    );

    const failure = await extractPdfTextWithRecovery(Buffer.from("%PDF"))
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(PdfRecoveryError);
    expect(failure).toMatchObject({ code: "PDF_ENCRYPTED" });
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/contract-pdf-repair-test", {
      recursive: true,
      force: true,
    });
  });

  it("distinguishes unavailable repair tooling from a damaged PDF", async () => {
    mocks.parsePdf.mockRejectedValueOnce(new Error("bad XRef entry"));
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-pdf-repair-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation(
      (...call: unknown[]) => {
        const callback = call.at(-1) as (error: NodeJS.ErrnoException) => void;
        callback(Object.assign(new Error("spawn pdfinfo ENOENT"), { code: "ENOENT" }));
      },
    );

    const failure = await extractPdfTextWithRecovery(Buffer.from("%PDF"))
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(PdfRecoveryError);
    expect(failure).toMatchObject({ code: "PDF_TOOL_UNAVAILABLE" });
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("classifies a PDF that system inspection cannot read as unreadable", async () => {
    mocks.parsePdf.mockRejectedValueOnce(new Error("Invalid PDF structure"));
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-pdf-repair-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation(
      (...call: unknown[]) => {
        const callback = call.at(-1) as (
          error: Error & { stderr: string },
        ) => void;
        callback(
          Object.assign(new Error("pdfinfo failed"), {
            stderr: "Syntax Error: Couldn't find trailer dictionary",
          }),
        );
      },
    );

    const failure = await extractPdfTextWithRecovery(Buffer.from("not a PDF"))
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(PdfRecoveryError);
    expect(failure).toMatchObject({ code: "PDF_UNREADABLE" });
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("reports a failed repair explicitly and cleans up after the retry", async () => {
    mocks.parsePdf
      .mockRejectedValueOnce(new Error("bad XRef entry"))
      .mockRejectedValueOnce(new Error("still invalid"));
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-pdf-repair-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(Buffer.from("%PDF repaired"));
    mocks.rm.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation(
      (...call: unknown[]) => {
        const args = call[1] as string[];
        const callback = call.at(-1) as (
          error: null,
          result: { stdout: string; stderr: string },
        ) => void;
        callback(null, {
          stdout: args.includes("pdfinfo") ? "Pages: 1\nEncrypted: no\n" : "",
          stderr: "",
        });
      },
    );

    const failure = await extractPdfTextWithRecovery(Buffer.from("%PDF"))
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(PdfRecoveryError);
    expect(failure).toMatchObject({ code: "PDF_REPAIR_FAILED" });
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("rejects oversized normalized output before reading it into memory", async () => {
    mocks.parsePdf.mockRejectedValueOnce(new Error("bad XRef entry"));
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-pdf-repair-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.stat.mockResolvedValue({ size: 50 * 1024 * 1024 + 1 });
    mocks.rm.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation((...call: unknown[]) => {
      const args = call[1] as string[];
      const callback = call.at(-1) as (
        error: null,
        result: { stdout: string; stderr: string },
      ) => void;
      callback(null, {
        stdout: args.includes("pdfinfo") ? "Pages: 1\nEncrypted: no\n" : "",
        stderr: "",
      });
    });

    const failure = await extractPdfTextWithRecovery(Buffer.from("%PDF"))
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(PdfRecoveryError);
    expect(failure).toMatchObject({ code: "PDF_REPAIR_FAILED" });
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("uses PDF-aware preflight to reject encryption before a permissive parser", async () => {
    mocks.parsePdf.mockResolvedValue({
      text: "--- Page 1 ---\nText readable with an empty password.",
    });
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-pdf-repair-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation((...call: unknown[]) => {
      const callback = call.at(-1) as (
        error: null,
        result: { stdout: string; stderr: string },
      ) => void;
      callback(null, { stdout: "Pages: 1\nEncrypted: yes\n", stderr: "" });
    });

    const failure = await extractPdfTextWithRecovery(
      Buffer.from("%PDF-1.7\ntrailer\n<< /Encr#79pt 7 0 R >>"),
    ).then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(PdfRecoveryError);
    expect(failure).toMatchObject({ code: "PDF_ENCRYPTED" });
    expect(mocks.parsePdf).not.toHaveBeenCalled();
  });

  it("preserves the primary classification when cleanup also fails", async () => {
    mocks.parsePdf.mockRejectedValueOnce(new Error("bad XRef entry"));
    mocks.mkdtemp.mockResolvedValue("/tmp/contract-pdf-repair-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rm.mockRejectedValue(new Error("temporary cleanup failed"));
    mocks.execFile.mockImplementation((...call: unknown[]) => {
      const callback = call.at(-1) as (
        error: null,
        result: { stdout: string; stderr: string },
      ) => void;
      callback(null, { stdout: "Pages: 1\nEncrypted: yes\n", stderr: "" });
    });

    const failure = await extractPdfTextWithRecovery(Buffer.from("%PDF"))
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(PdfRecoveryError);
    expect(failure).toMatchObject({ code: "PDF_ENCRYPTED" });
    expect(mocks.rm).toHaveBeenCalled();
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
    expect(systemPrompt).toContain("provenance-v4");
    expect(systemPrompt).toContain("unit business_days");
    expect(systemPrompt).toContain('"zum Quartalsende"');
    expect(systemPrompt).toContain("Never convert months or weeks into days");
    expect(systemPrompt).toContain("Do not return noticeDeadline");
    expect(systemPrompt).toContain("Do not extract owner");
  });

  it("audits an explicit missing notice period and recovers competing clauses", async () => {
    mockOpenAiResponse({
      fields: {
        ...extractedContract.fields,
        noticePeriod: {
          value: null,
          status: "not_found",
          confidence: "low",
          page: null,
          clause: null,
          quote: null,
          note: null,
          alternatives: [],
        },
      },
    }, { queueNoticeAudit: false });
    const threeMonths = {
      amount: 3,
      unit: "months",
      anchor: "term_end",
      purpose: "non_renewal",
    };
    const sixMonths = { ...threeMonths, amount: 6 };
    mockOpenAiResponse({
      noticePeriod: {
        value: [threeMonths, sixMonths],
        status: "conflicting",
        confidence: "high",
        page: null,
        clause: null,
        quote: null,
        note: "The schedule requires six months for the same non-renewal right.",
        alternatives: [
          {
            value: threeMonths,
            page: 2,
            clause: "8.1",
            quote: "Notice must be given three months before the current term expires.",
          },
          {
            value: sixMonths,
            page: 5,
            clause: "Schedule A.4",
            quote: "Notice of non-renewal must be received six months before expiry.",
          },
        ],
      },
    });

    const result = await extractContractFromText(
      "--- Page 2 --- three month clause\n--- Page 5 --- six month schedule clause",
      "synthetic-conflict.pdf",
    );

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0].messages[0].content).toContain(
      "safety auditor checking one extracted contract field",
    );
    expect(result.extraction.contract.fields.noticePeriod).toMatchObject({
      status: "conflicting",
      value: [threeMonths, sixMonths],
      page: 2,
      clause: "8.1",
      quote: "Notice must be given three months before the current term expires.",
      alternatives: [
        expect.objectContaining({ value: threeMonths, page: 2 }),
        expect.objectContaining({ value: sixMonths, page: 5 }),
      ],
    });
  });

  it("audits a first-pass found notice and catches a competing schedule clause", async () => {
    const threeMonths = {
      amount: 3,
      unit: "months",
      anchor: "term_end",
      purpose: "non_renewal",
    };
    const sixMonths = { ...threeMonths, amount: 6 };
    mockOpenAiResponse({
      fields: {
        ...extractedContract.fields,
        noticePeriod: found(
          threeMonths,
          2,
          "Notice must be given three months before the current term expires.",
        ),
      },
    }, { queueNoticeAudit: false });
    mockOpenAiResponse({
      noticePeriod: {
        value: [threeMonths, sixMonths],
        status: "conflicting",
        confidence: "high",
        page: null,
        clause: null,
        quote: null,
        note: "The schedule requires six months for the same non-renewal right.",
        alternatives: [
          {
            value: threeMonths,
            page: 2,
            clause: "8.1",
            quote: "Notice must be given three months before the current term expires.",
          },
          {
            value: sixMonths,
            page: 5,
            clause: "Schedule A.4",
            quote: "Notice of non-renewal must be received six months before expiry.",
          },
        ],
      },
    });

    const result = await extractContractFromText(
      [
        "--- Page 2 ---",
        "8.1 Notice must be given three months before the current term expires.",
        "--- Page 5 ---",
        "Schedule A.4 Notice of non-renewal must be received six months before expiry.",
      ].join("\n"),
      "synthetic-found-then-conflict.pdf",
    );

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(result.extraction.contract.fields.noticePeriod).toMatchObject({
      status: "conflicting",
      value: [threeMonths, sixMonths],
      alternatives: [
        expect.objectContaining({ value: threeMonths, page: 2 }),
        expect.objectContaining({ value: sixMonths, page: 5 }),
      ],
    });
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