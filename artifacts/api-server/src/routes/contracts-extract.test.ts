import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contractIngestCompletionsTable,
  contractIngestItemsTable,
  contractIngestRunsTable,
  db,
} from "@workspace/db";

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

function mockExtractionResult(
  source: "text" | "ocr",
  ocrConfidence: "High" | "Medium" | "Low" | null,
  ocrPageCount: number | null = null,
) {
  return {
    filename: "contract.pdf",
    extraction: {
      source,
      ocrConfidence,
      ocrPageCount,
      ocrPagesProcessed: ocrPageCount,
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
        pageCount: 12,
        pagesProcessed: 12,
      });
      mocks.extractContractFromText.mockResolvedValue(
        mockExtractionResult("ocr", ocrConfidence, 12),
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
        {
          source: "ocr",
          ocrConfidence,
          ocrPageCount: 12,
          ocrPagesProcessed: 12,
        },
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
        ocrPageCount: null,
        ocrPagesProcessed: null,
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

  it("returns a page-specific 422 when OCR cannot complete a scanned page", async () => {
    mocks.extractReadablePdfText.mockResolvedValue("");
    mocks.extractScannedPdfText.mockRejectedValue(
      Object.assign(
        new Error(
          "We could not fully transcribe scanned page 7 of 12. Split the PDF around that page and upload the parts separately. No partial review draft was created.",
        ),
        { code: "OCR_INCOMPLETE" },
      ),
    );

    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", pdfLike, {
        filename: "dense-scan.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toContain("page 7 of 12");
    expect(response.body.error).toContain("Split the PDF around that page");
    expect(mocks.extractContractFromText).not.toHaveBeenCalled();
  });

  it("returns a clear 422 when complete OCR text exceeds the safe review limit", async () => {
    mocks.extractReadablePdfText.mockResolvedValue("");
    mocks.extractScannedPdfText.mockResolvedValue({
      text: ocrContractText,
      confidence: "High",
      pageCount: 12,
      pagesProcessed: 12,
    });
    const oversizedTextError = Object.assign(
      new Error(
        "This contract contains too much extracted text to process in one review (250,001 characters; the limit is 250,000). Split the PDF into smaller files and upload each part. No pages were omitted.",
      ),
      { code: "CONTRACT_TEXT_TOO_LONG" },
    );
    mocks.extractContractFromText.mockRejectedValue(oversizedTextError);

    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", pdfLike, {
        filename: "long-scan.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toContain("Split the PDF into smaller files");
    expect(response.body.error).toContain("OCR completed all 12 of 12 pages before stopping");
  });
});

describe("resumable contract ingest runs", () => {
  it("restores outcomes, retries stored PDFs, and clears the run after handoff", async () => {
    const runId = randomUUID();
    const firstItemId = `${runId}:0`;
    const secondItemId = `${runId}:1`;
    const firstPdf = Buffer.from("%PDF-1.7\nfirst resumable contract");
    const secondPdf = Buffer.from("%PDF-1.7\nsecond resumable contract");
    mocks.extractReadablePdfText.mockResolvedValue(readableContractText);
    mocks.extractContractFromText
      .mockResolvedValueOnce(mockExtractionResult("text", null))
      .mockRejectedValueOnce(new Error("Temporary extraction failure"))
      .mockResolvedValueOnce(mockExtractionResult("text", null));

    try {
      const registerResponse = await request(app)
        .post("/api/contracts/ingest-runs")
        .field("runId", runId)
        .field("itemIds", firstItemId)
        .field("itemIds", secondItemId)
        .attach("files", firstPdf, { filename: "first.pdf", contentType: "application/pdf" })
        .attach("files", secondPdf, { filename: "second.pdf", contentType: "application/pdf" });

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.items).toMatchObject([
        { id: firstItemId, filename: "first.pdf", state: "failed" },
        { id: secondItemId, filename: "second.pdf", state: "failed" },
      ]);

      const firstResponse = await request(app)
        .post("/api/contracts/extract")
        .field("ingestRunId", runId)
        .field("ingestItemId", firstItemId)
        .attach("files", firstPdf, { filename: "first.pdf", contentType: "application/pdf" });
      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body).toMatchObject({ ingestRunId: runId, ingestItemId: firstItemId });

      const secondResponse = await request(app)
        .post("/api/contracts/extract")
        .field("ingestRunId", runId)
        .field("ingestItemId", secondItemId)
        .attach("files", secondPdf, { filename: "second.pdf", contentType: "application/pdf" });
      expect(secondResponse.status).toBe(502);

      const restoredResponse = await request(app).get("/api/contracts/ingest-runs/current");
      expect(restoredResponse.status).toBe(200);
      expect(restoredResponse.body).toMatchObject({
        id: runId,
        items: [
          { id: firstItemId, state: "ready", extraction: { ingestItemId: firstItemId } },
          { id: secondItemId, state: "failed", extraction: null },
        ],
      });

      const readyRetryResponse = await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(firstItemId)}/retry`);
      expect(readyRetryResponse.status).toBe(409);
      expect(readyRetryResponse.body).toEqual({ error: "Only failed ingest items can be retried." });
      const [readyItem] = await db.select().from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, firstItemId));
      expect(readyItem).toMatchObject({
        state: "ready",
        message: "Ready for review",
        extraction: expect.objectContaining({ ingestItemId: firstItemId }),
      });

      const failedCompleteResponse = await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(secondItemId)}/complete`);
      expect(failedCompleteResponse.status).toBe(409);
      expect(failedCompleteResponse.body).toEqual({ error: "Only ready ingest items can be completed." });

      const retryResponse = await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(secondItemId)}/retry`);
      expect(retryResponse.status).toBe(200);
      expect(retryResponse.body).toMatchObject({ ingestRunId: runId, ingestItemId: secondItemId });

      const completionResponses = await Promise.all([
        request(app)
          .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(firstItemId)}/complete`),
        request(app)
          .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(secondItemId)}/complete`),
      ]);
      expect(completionResponses.map((response) => response.status)).toEqual([204, 204]);
      expect((await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(secondItemId)}/complete`)).status).toBe(204);

      const [remainingRun] = await db.select({ id: contractIngestRunsTable.id })
        .from(contractIngestRunsTable)
        .where(eq(contractIngestRunsTable.id, runId));
      expect(remainingRun).toBeUndefined();
    } finally {
      await db.delete(contractIngestCompletionsTable).where(eq(contractIngestCompletionsTable.runId, runId));
      await db.delete(contractIngestItemsTable).where(eq(contractIngestItemsTable.runId, runId));
      await db.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
    }
  });
});