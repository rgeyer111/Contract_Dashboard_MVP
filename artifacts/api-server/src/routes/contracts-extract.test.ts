import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractContractFromText: vi.fn(),
  extractReadablePdfText: vi.fn(),
  extractScannedPdfText: vi.fn(),
}));

vi.mock("../lib/contract-extraction", () => mocks);

import app from "../app";

const pdfLike = Buffer.from("%PDF-1.7\nmock contract");
const readableContractText =
  "This embedded contract text is long enough to remain on the direct text extraction path.";
const ocrContractText =
  "This OCR transcription is long enough to continue through contract field extraction.";

function mockExtractionResult(source: "text" | "ocr", ocrConfidence: "High" | "Medium" | "Low" | null) {
  return {
    filename: "contract.pdf",
    extraction: {
      source,
      ocrConfidence,
    },
  };
}

beforeEach(() => {
  mocks.extractContractFromText.mockReset();
  mocks.extractReadablePdfText.mockReset();
  mocks.extractScannedPdfText.mockReset();
});

describe("POST /api/contracts/extract extraction source metadata", () => {
  it.each(["High", "Medium", "Low"] as const)(
    "reports OCR source with %s legibility",
    async (ocrConfidence) => {
      mocks.extractReadablePdfText.mockResolvedValue("");
      mocks.extractScannedPdfText.mockResolvedValue({
        text: ocrContractText,
        confidence: ocrConfidence,
      });
      mocks.extractContractFromText.mockResolvedValue(
        mockExtractionResult("ocr", ocrConfidence),
      );

      const response = await request(app)
        .post("/api/contracts/extract")
        .attach("file", pdfLike, {
          filename: "contract.pdf",
          contentType: "application/pdf",
        });

      expect(response.status).toBe(200);
      expect(response.body.extraction).toMatchObject({
        source: "ocr",
        ocrConfidence,
      });
      expect(mocks.extractContractFromText).toHaveBeenCalledWith(
        ocrContractText,
        "contract.pdf",
        { source: "ocr", ocrConfidence },
      );
    },
  );

  it("reports embedded text with null OCR confidence", async () => {
    mocks.extractReadablePdfText.mockResolvedValue(readableContractText);
    mocks.extractContractFromText.mockResolvedValue(
      mockExtractionResult("text", null),
    );

    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", pdfLike, {
        filename: "contract.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(200);
    expect(response.body.extraction).toMatchObject({
      source: "text",
      ocrConfidence: null,
    });
    expect(mocks.extractScannedPdfText).not.toHaveBeenCalled();
    expect(mocks.extractContractFromText).toHaveBeenCalledWith(
      readableContractText,
      "contract.pdf",
      { source: "text", ocrConfidence: undefined },
    );
  });

  it("returns a clear 422 and stops before contract extraction when OCR fails", async () => {
    mocks.extractReadablePdfText.mockResolvedValue("");
    mocks.extractScannedPdfText.mockRejectedValue(new Error("OCR unavailable"));

    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", pdfLike, {
        filename: "unreadable-scan.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error:
        "We could not read text from this PDF, including with OCR. Make sure the scan is clear and try again.",
    });
    expect(response.body).not.toHaveProperty("extraction");
    expect(mocks.extractContractFromText).not.toHaveBeenCalled();
  });
});