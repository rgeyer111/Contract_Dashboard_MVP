import request from "../test-request";
import { requestAs } from "../test-request";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contractIngestCompletionsTable,
  contractIngestItemsTable,
  contractIngestObjectCleanupTable,
  contractIngestRunsTable,
  contractsTable,
  db,
} from "@workspace/db";

const mocks = vi.hoisted(() => {
  class PdfRecoveryError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    extractContractFromText: vi.fn(),
    extractPdfTextWithRecovery: vi.fn(),
    extractScannedPdfText: vi.fn(),
    PdfRecoveryError,
    storeContractIngestPdf: vi.fn(),
    createContractIngestStoragePath: vi.fn(),
    readContractIngestPdf: vi.fn(),
    deleteContractIngestPdfs: vi.fn(),
    deleteContractIngestPdf: vi.fn(),
    storedPdfs: new Map<string, Buffer>(),
  };
});

vi.mock("../lib/contract-extraction", () => mocks);
vi.mock("../lib/contract-ingest-storage", () => ({
  storeContractIngestPdf: mocks.storeContractIngestPdf,
  createContractIngestStoragePath: mocks.createContractIngestStoragePath,
  readContractIngestPdf: mocks.readContractIngestPdf,
  deleteContractIngestPdfs: mocks.deleteContractIngestPdfs,
  deleteContractIngestPdf: mocks.deleteContractIngestPdf,
}));

import app from "../app";
import {
  processContractIngestObjectCleanup,
  recoverContractIngestState,
  reserveAndStoreContractIngestPdf,
} from "../lib/contract-ingest-cleanup";

const pdfLike = Buffer.from("%PDF-1.7\nmock contract");
const readableContractText =
  "This embedded contract text is long enough to remain on the direct text extraction path.";
const ocrContractText =
  "This OCR transcription is long enough to continue through contract field extraction.";
const savedContractIds = new Set<string>();

async function createSavedContractForItem(itemId: string) {
  const [item] = await db.select({
    filename: contractIngestItemsTable.filename,
    hash: contractIngestItemsTable.hash,
  }).from(contractIngestItemsTable).where(eq(contractIngestItemsTable.id, itemId));
  if (!item) throw new Error(`Missing ingest item ${itemId}`);
  const [saved] = await db.insert(contractsTable).values({
    filename: item.filename,
    fileHash: item.hash,
    contract: {},
    confidence: {},
  }).returning({ id: contractsTable.id });
  savedContractIds.add(saved.id);
  return saved.id;
}

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
  mocks.extractPdfTextWithRecovery.mockReset();
  mocks.extractScannedPdfText.mockReset();
  mocks.storeContractIngestPdf.mockReset();
  mocks.createContractIngestStoragePath.mockReset();
  mocks.readContractIngestPdf.mockReset();
  mocks.deleteContractIngestPdfs.mockReset();
  mocks.deleteContractIngestPdf.mockReset();
  mocks.storedPdfs.clear();
  mocks.createContractIngestStoragePath.mockImplementation(
    () => `/objects/uploads/contract-ingest/${randomUUID()}`,
  );
  mocks.storeContractIngestPdf.mockImplementation(async (pdf: Buffer, objectPath?: string) => {
    const path = objectPath ?? mocks.createContractIngestStoragePath();
    mocks.storedPdfs.set(path, Buffer.from(pdf));
    return path;
  });
  mocks.readContractIngestPdf.mockImplementation(async (path: string) => {
    const pdf = mocks.storedPdfs.get(path);
    if (!pdf) throw new Error("Stored PDF missing");
    return Buffer.from(pdf);
  });
  mocks.deleteContractIngestPdfs.mockImplementation(async (paths: string[]) => {
    paths.forEach((path) => mocks.storedPdfs.delete(path));
  });
  mocks.deleteContractIngestPdf.mockImplementation(async (path: string) => {
    mocks.storedPdfs.delete(path);
  });
});

afterEach(async () => {
  for (const id of savedContractIds) {
    await db.delete(contractsTable).where(eq(contractsTable.id, id));
  }
  savedContractIds.clear();
});

describe("POST /api/contracts/extract extraction source metadata", () => {
  it.each(["High", "Medium", "Low"] as const)(
    "reports OCR source with %s legibility",
    async (ocrConfidence) => {
      mocks.extractPdfTextWithRecovery.mockResolvedValue({ text: "", repaired: false });
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
    mocks.extractPdfTextWithRecovery.mockResolvedValue({
      text: readableContractText,
      repaired: false,
    });
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

  it("uses recovered embedded text without attempting OCR", async () => {
    const actualExtraction = await vi.importActual<
      typeof import("../lib/contract-extraction")
    >("../lib/contract-extraction");
    const original = Buffer.from(
      readFileSync(
        new URL(
          "../test-fixtures/malformed-xref-vendor-contract.pdf.b64",
          import.meta.url,
        ),
        "utf8",
      ),
      "base64",
    );
    mocks.extractPdfTextWithRecovery.mockImplementation(async (bytes: Buffer) => {
      return actualExtraction.extractPdfTextWithRecovery(bytes);
    });
    mocks.extractContractFromText.mockResolvedValue(
      mockExtractionResult("text", null),
    );

    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", original, {
        filename: "malformed-xref.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(200);
    expect(response.body.extraction.source).toBe("text");
    expect(mocks.extractScannedPdfText).not.toHaveBeenCalled();
  });

  it("returns an actionable encrypted-PDF error without attempting OCR", async () => {
    mocks.extractPdfTextWithRecovery.mockRejectedValue(
      new mocks.PdfRecoveryError(
        "PDF_ENCRYPTED",
        "This PDF is password-protected or encrypted. Upload an unlocked PDF and try again.",
      ),
    );

    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", pdfLike, {
        filename: "encrypted.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error:
        "This PDF is password-protected or encrypted. Upload an unlocked PDF and try again.",
      code: "PDF_ENCRYPTED",
    });
    expect(mocks.extractScannedPdfText).not.toHaveBeenCalled();
  });

  it("returns a clear 422 and stops before contract extraction when OCR fails", async () => {
    mocks.extractPdfTextWithRecovery.mockResolvedValue({ text: "", repaired: false });
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
      code: "UNREADABLE",
    });
    expect(response.body).not.toHaveProperty("extraction");
    expect(mocks.extractContractFromText).not.toHaveBeenCalled();
  });

  it("returns a page-specific 422 when OCR cannot complete a scanned page", async () => {
    mocks.extractPdfTextWithRecovery.mockResolvedValue({ text: "", repaired: false });
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
    mocks.extractPdfTextWithRecovery.mockResolvedValue({ text: "", repaired: false });
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
  it("does not clean an active reservation while ownership transfer is pending", async () => {
    const storagePath = `/objects/uploads/contract-ingest/${randomUUID()}`;
    let releaseStore!: () => void;
    const storeReleased = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    let storeStarted!: () => void;
    const storeHasStarted = new Promise<void>((resolve) => {
      storeStarted = resolve;
    });
    mocks.createContractIngestStoragePath.mockReturnValue(storagePath);
    mocks.storeContractIngestPdf.mockImplementation(async (pdf: Buffer, objectPath?: string) => {
      const path = objectPath ?? storagePath;
      mocks.storedPdfs.set(path, Buffer.from(pdf));
      storeStarted();
      await storeReleased;
      return path;
    });

    const storing = reserveAndStoreContractIngestPdf(pdfLike);
    try {
      await storeHasStarted;
      await processContractIngestObjectCleanup([storagePath]);

      const [reservation] = await db.select()
        .from(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
      expect(reservation).toMatchObject({ storagePath, state: "uploading" });
      expect(mocks.storedPdfs.has(storagePath)).toBe(true);

      releaseStore();
      await expect(storing).resolves.toBe(storagePath);
    } finally {
      releaseStore();
      await storing.catch(() => undefined);
      await db.delete(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
      mocks.storedPdfs.delete(storagePath);
    }
  });

  it("queues ownership failures and retries cleanup after the first deletion failure", async () => {
    const runId = randomUUID();
    const itemId = `${runId}:0`;
    const transactionSpy = vi.spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("ownership transaction failed"));
    mocks.deleteContractIngestPdf.mockRejectedValueOnce(new Error("storage temporarily unavailable"));

    try {
      const response = await request(app)
        .post("/api/contracts/ingest-runs")
        .field("runId", runId)
        .field("itemIds", itemId)
        .attach("files", pdfLike, { filename: "transaction-failure.pdf", contentType: "application/pdf" });

      expect(response.status).toBe(500);
      const [storagePath] = [...mocks.storedPdfs.keys()];
      const [reservation] = await db.select()
        .from(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
      expect(reservation).toMatchObject({
        state: "cleanup_pending",
        attempts: 1,
        lastError: "storage temporarily unavailable",
      });
      expect(mocks.storedPdfs.size).toBe(1);

      await processContractIngestObjectCleanup();
      expect(mocks.storedPdfs.size).toBe(0);
      const [remainingReservation] = await db.select()
        .from(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
      expect(remainingReservation).toBeUndefined();
    } finally {
      transactionSpy.mockRestore();
      await db.delete(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.state, "cleanup_pending"));
      await db.delete(contractIngestCompletionsTable).where(eq(contractIngestCompletionsTable.runId, runId));
      await db.delete(contractIngestItemsTable).where(eq(contractIngestItemsTable.runId, runId));
      await db.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
    }
  });

  it("recovers interrupted processing and stale unowned reservations after restart", async () => {
    const runId = randomUUID();
    const itemId = `${runId}:0`;
    const freshItemId = `${runId}:1`;
    const interruptedPath = `/objects/uploads/contract-ingest/${randomUUID()}`;
    const freshOwnedPath = `/objects/uploads/contract-ingest/${randomUUID()}`;
    const unownedPath = `/objects/uploads/contract-ingest/${randomUUID()}`;
    const activePath = `/objects/uploads/contract-ingest/${randomUUID()}`;
    const staleDate = new Date(Date.now() - 60 * 60_000);
    mocks.storedPdfs.set(interruptedPath, Buffer.from("interrupted"));
    mocks.storedPdfs.set(freshOwnedPath, Buffer.from("fresh interrupted"));
    mocks.storedPdfs.set(unownedPath, Buffer.from("unowned"));
    mocks.storedPdfs.set(activePath, Buffer.from("active"));

    try {
      await db.insert(contractIngestRunsTable).values({ id: runId });
      await db.insert(contractIngestItemsTable).values({
        id: itemId,
        runId,
        filename: "interrupted.pdf",
        size: 11,
        hash: randomUUID(),
        storagePath: interruptedPath,
        state: "processing",
        message: null,
        extraction: null,
        handedOffAt: null,
        createdAt: staleDate,
        updatedAt: staleDate,
      });
      await db.insert(contractIngestItemsTable).values({
        id: freshItemId,
        runId,
        filename: "fresh-interrupted.pdf",
        size: 17,
        hash: randomUUID(),
        storagePath: freshOwnedPath,
        state: "processing",
        message: null,
        extraction: null,
        handedOffAt: null,
      });
      await db.insert(contractIngestObjectCleanupTable).values([
        { storagePath: interruptedPath, state: "uploading", createdAt: staleDate },
        { storagePath: unownedPath, state: "uploading", createdAt: staleDate },
        { storagePath: activePath, state: "uploading" },
      ]);

      await recoverContractIngestState({
        itemIds: [itemId, freshItemId],
        storagePaths: [interruptedPath, unownedPath, activePath],
      });

      const [interruptedItem] = await db.select()
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, itemId));
      expect(interruptedItem).toMatchObject({
        state: "failed",
        message: "Processing was interrupted. Retry this PDF.",
      });
      const [freshItem] = await db.select()
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, freshItemId));
      expect(freshItem).toMatchObject({ state: "processing", message: null });
      expect(mocks.storedPdfs.has(interruptedPath)).toBe(true);
      expect(mocks.storedPdfs.has(unownedPath)).toBe(false);
      expect(mocks.storedPdfs.has(activePath)).toBe(true);
      const [ownedReservation] = await db.select()
        .from(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, interruptedPath));
      expect(ownedReservation).toMatchObject({ state: "uploading" });
      const [activeReservation] = await db.select()
        .from(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, activePath));
      expect(activeReservation).toMatchObject({ state: "uploading" });

      await recoverContractIngestState({
        itemIds: [freshItemId],
        storagePaths: [activePath],
        olderThan: new Date(Date.now() + 1_000),
      });
      const [recoveredFreshItem] = await db.select()
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, freshItemId));
      expect(recoveredFreshItem).toMatchObject({
        state: "failed",
        message: "Processing was interrupted. Retry this PDF.",
      });
      expect(mocks.storedPdfs.has(activePath)).toBe(false);
    } finally {
      await db.delete(contractIngestObjectCleanupTable)
        .where(inArray(
          contractIngestObjectCleanupTable.storagePath,
          [interruptedPath, freshOwnedPath, unownedPath, activePath],
        ));
      await db.delete(contractIngestCompletionsTable).where(eq(contractIngestCompletionsTable.runId, runId));
      await db.delete(contractIngestItemsTable).where(eq(contractIngestItemsTable.runId, runId));
      await db.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
      mocks.storedPdfs.delete(interruptedPath);
      mocks.storedPdfs.delete(freshOwnedPath);
      mocks.storedPdfs.delete(unownedPath);
      mocks.storedPdfs.delete(activePath);
    }
  });

  it("prevents a recovered retry from overwriting a newer attempt on the same stored PDF", async () => {
    const runId = randomUUID();
    const itemId = `${runId}:0`;
    let releaseFirstAttempt!: () => void;
    const firstAttemptReleased = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    let firstAttemptStarted!: () => void;
    const firstAttemptHasStarted = new Promise<void>((resolve) => {
      firstAttemptStarted = resolve;
    });
    let readableAttempt = 0;
    mocks.extractPdfTextWithRecovery.mockImplementation(async () => {
      readableAttempt += 1;
      if (readableAttempt === 1) {
        firstAttemptStarted();
        await firstAttemptReleased;
      }
      return { text: readableContractText, repaired: false };
    });
    mocks.extractContractFromText
      .mockResolvedValueOnce({
        ...mockExtractionResult("text", null),
        attempt: "newer",
      })
      .mockResolvedValueOnce({
        ...mockExtractionResult("text", null),
        attempt: "stale",
      });

    try {
      const registered = await request(app)
        .post("/api/contracts/ingest-runs")
        .field("runId", runId)
        .field("itemIds", itemId)
        .attach("files", pdfLike, { filename: "same-file.pdf", contentType: "application/pdf" });
      expect(registered.status).toBe(201);

      const firstRetry = request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(itemId)}/retry`)
        .then((response) => response);
      await firstAttemptHasStarted;
      const [firstProcessingItem] = await db.select()
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, itemId));
      expect(firstProcessingItem.processingAttemptId).toEqual(expect.any(String));

      await recoverContractIngestState({
        itemIds: [itemId],
        olderThan: new Date(Date.now() + 1_000),
      });
      const [recoveredItem] = await db.select()
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, itemId));
      expect(recoveredItem).toMatchObject({
        state: "failed",
        processingAttemptId: null,
      });

      const secondRetry = await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(itemId)}/retry`);
      expect(secondRetry.status).toBe(200);
      expect(secondRetry.body.attempt).toBe("newer");

      releaseFirstAttempt();
      const staleRetry = await firstRetry;
      expect(staleRetry.status).toBe(409);
      expect(staleRetry.body).toEqual({
        error: "This retry attempt was superseded. Use the latest result.",
        code: "SUPERSEDED",
      });
      expect(staleRetry.body).not.toHaveProperty("attempt");

      const [finalItem] = await db.select()
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, itemId));
      expect(finalItem).toMatchObject({
        state: "ready",
        processingAttemptId: null,
        extraction: expect.objectContaining({ attempt: "newer" }),
      });
      const contractId = await createSavedContractForItem(itemId);
      const completion = await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(itemId)}/complete`)
        .send({ contractId });
      expect(completion.status).toBe(204);
    } finally {
      releaseFirstAttempt();
      await db.delete(contractIngestCompletionsTable).where(eq(contractIngestCompletionsTable.runId, runId));
      await db.delete(contractIngestItemsTable).where(eq(contractIngestItemsTable.runId, runId));
      await db.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
      mocks.storedPdfs.clear();
    }
  });

  it("serializes concurrent retry, abandon, replacement, and completion attempts", async () => {
    const runId = randomUUID();
    const itemId = `${runId}:0`;
    const replacementPdf = Buffer.from("%PDF-1.7\nreplacement contract");
    let releaseExtraction!: () => void;
    const extractionReleased = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    let extractionStarted!: () => void;
    const extractionHasStarted = new Promise<void>((resolve) => {
      extractionStarted = resolve;
    });
    mocks.extractPdfTextWithRecovery.mockImplementation(async () => {
      extractionStarted();
      await extractionReleased;
      return { text: readableContractText, repaired: false };
    });
    mocks.extractContractFromText.mockResolvedValue(mockExtractionResult("text", null));

    try {
      const registered = await request(app)
        .post("/api/contracts/ingest-runs")
        .field("runId", runId)
        .field("itemIds", itemId)
        .attach("files", pdfLike, { filename: "original.pdf", contentType: "application/pdf" });
      expect(registered.status).toBe(201);

      const retryRequest = request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(itemId)}/retry`)
        .then((response) => response);
      await extractionHasStarted;
      const contractId = await createSavedContractForItem(itemId);
      const competingRequests = Promise.all([
        request(app).delete(`/api/contracts/ingest-runs/${runId}`),
        request(app)
          .post("/api/contracts/ingest-runs")
          .field("runId", runId)
          .field("itemIds", itemId)
          .attach("files", replacementPdf, { filename: "replacement.pdf", contentType: "application/pdf" }),
        request(app)
          .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(itemId)}/complete`)
          .send({ contractId }),
      ]);
      const [abandonResponse, replacementResponse, completionResponse] = await competingRequests;
      releaseExtraction();
      const retryResponse = await retryRequest;

      expect(retryResponse.status).toBe(409);
      expect(retryResponse.body).toEqual({
        error: "This retry attempt was superseded. Use the latest result.",
        code: "SUPERSEDED",
      });
      expect(replacementResponse.status).toBe(201);
      expect([204, 409]).toContain(abandonResponse.status);
      expect([404, 409]).toContain(completionResponse.status);

      const [remainingRun] = await db.select()
        .from(contractIngestRunsTable)
        .where(eq(contractIngestRunsTable.id, runId));
      if (remainingRun) {
        const items = await db.select()
          .from(contractIngestItemsTable)
          .where(eq(contractIngestItemsTable.runId, runId));
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          id: itemId,
          filename: "replacement.pdf",
          state: "failed",
        });
        expect(mocks.storedPdfs.has(items[0].storagePath)).toBe(true);
      }
    } finally {
      releaseExtraction();
      await db.delete(contractIngestCompletionsTable).where(eq(contractIngestCompletionsTable.runId, runId));
      await db.delete(contractIngestItemsTable).where(eq(contractIngestItemsTable.runId, runId));
      await db.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
      const storagePaths = [...mocks.storedPdfs.keys()];
      if (storagePaths.length) {
        await db.delete(contractIngestObjectCleanupTable)
          .where(inArray(contractIngestObjectCleanupTable.storagePath, storagePaths));
      }
      mocks.storedPdfs.clear();
    }
  });

  it("restores outcomes, retries stored PDFs, and clears the run after handoff", async () => {
    const runId = randomUUID();
    const firstItemId = `${runId}:0`;
    const secondItemId = `${runId}:1`;
    const firstPdf = Buffer.from("%PDF-1.7\nfirst resumable contract");
    const secondPdf = Buffer.from("%PDF-1.7\nsecond resumable contract");
    mocks.extractPdfTextWithRecovery.mockResolvedValue({
      text: readableContractText,
      repaired: false,
    });
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
      expect(registerResponse.body.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: firstItemId, filename: "first.pdf", state: "failed" }),
        expect.objectContaining({ id: secondItemId, filename: "second.pdf", state: "failed" }),
      ]));
      const registeredItems = await db.select().from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.runId, runId));
      expect(registeredItems).toHaveLength(2);
      expect(registeredItems.every((item) => item.storagePath.startsWith("/objects/"))).toBe(true);
      expect(registeredItems.some((item) => "pdf" in item)).toBe(false);

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
      expect(restoredResponse.body.id).toBe(runId);
      expect(restoredResponse.body.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: firstItemId,
          state: "ready",
          extraction: expect.objectContaining({ ingestItemId: firstItemId }),
        }),
        expect.objectContaining({ id: secondItemId, state: "failed", extraction: null }),
      ]));

      const readyRetryResponse = await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(firstItemId)}/retry`);
      expect(readyRetryResponse.status).toBe(409);
      expect(readyRetryResponse.body).toEqual({
        error: "Only failed ingest items can be retried.",
        code: "INVALID_UPLOAD",
      });
      const [readyItem] = await db.select().from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, firstItemId));
      expect(readyItem).toMatchObject({
        state: "ready",
        message: "Ready for review",
        extraction: expect.objectContaining({ ingestItemId: firstItemId }),
      });

      const failedCompleteResponse = await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(secondItemId)}/complete`)
        .send({ contractId: randomUUID() });
      expect(failedCompleteResponse.status).toBe(409);
      expect(failedCompleteResponse.body).toEqual({ error: "Only ready ingest items can be completed." });

      const retryResponse = await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(secondItemId)}/retry`);
      expect(retryResponse.status).toBe(200);
      expect(retryResponse.body).toMatchObject({ ingestRunId: runId, ingestItemId: secondItemId });
      const [retriedItem] = await db.select().from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, secondItemId));
      expect(mocks.readContractIngestPdf).toHaveBeenCalledWith(retriedItem.storagePath);

      const firstContractId = await createSavedContractForItem(firstItemId);
      const secondContractId = await createSavedContractForItem(secondItemId);
      const completionResponses = await Promise.all([
        request(app)
          .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(firstItemId)}/complete`)
          .send({ contractId: firstContractId }),
        request(app)
          .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(secondItemId)}/complete`)
          .send({ contractId: secondContractId }),
      ]);
      expect(completionResponses.map((response) => response.status)).toEqual([204, 204]);
      expect((await request(app)
        .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(secondItemId)}/complete`)
        .send({ contractId: secondContractId })).status).toBe(204);

      const [remainingRun] = await db.select({ id: contractIngestRunsTable.id })
        .from(contractIngestRunsTable)
        .where(eq(contractIngestRunsTable.id, runId));
      expect(remainingRun).toBeUndefined();
      expect(mocks.storedPdfs.size).toBe(2);
    } finally {
      await db.delete(contractIngestCompletionsTable).where(eq(contractIngestCompletionsTable.runId, runId));
      await db.delete(contractIngestItemsTable).where(eq(contractIngestItemsTable.runId, runId));
      await db.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
    }
  });

  it("deletes temporary App Storage objects when a run is abandoned", async () => {
    const runId = randomUUID();
    const itemId = `${runId}:0`;
    try {
      const registered = await request(app)
        .post("/api/contracts/ingest-runs")
        .field("runId", runId)
        .field("itemIds", itemId)
        .attach("files", pdfLike, { filename: "abandoned.pdf", contentType: "application/pdf" });
      expect(registered.status).toBe(201);
      expect(mocks.storedPdfs.size).toBe(1);

      const abandoned = await request(app).delete(`/api/contracts/ingest-runs/${runId}`);
      expect(abandoned.status).toBe(204);
      expect(mocks.storedPdfs.size).toBe(0);
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

  it("returns 404 when another account supplies owned ingest run or item IDs", async () => {
    const owner = `owner-${randomUUID()}`;
    const outsider = `outsider-${randomUUID()}`;
    const runId = randomUUID();
    const itemId = `${runId}:0`;
    try {
      const registered = await requestAs(app, owner)
        .post("/api/contracts/ingest-runs")
        .field("runId", runId)
        .field("itemIds", itemId)
        .attach("files", pdfLike, { filename: "private.pdf", contentType: "application/pdf" });
      expect(registered.status).toBe(201);

      const [current, abandon, retry, complete, replace, register] = await Promise.all([
        requestAs(app, outsider).get("/api/contracts/ingest-runs/current"),
        requestAs(app, outsider).delete(`/api/contracts/ingest-runs/${runId}`),
        requestAs(app, outsider).post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(itemId)}/retry`),
        requestAs(app, outsider)
          .post(`/api/contracts/ingest-runs/${runId}/items/${encodeURIComponent(itemId)}/complete`)
          .send({ contractId: randomUUID() }),
        requestAs(app, outsider)
          .post("/api/contracts/extract")
          .field("ingestRunId", runId)
          .field("ingestItemId", itemId)
          .attach("files", pdfLike, { filename: "replace.pdf", contentType: "application/pdf" }),
        requestAs(app, outsider)
          .post("/api/contracts/ingest-runs")
          .field("runId", runId)
          .field("itemIds", itemId)
          .attach("files", pdfLike, { filename: "replace.pdf", contentType: "application/pdf" }),
      ]);
      expect(current.status).toBe(200);
      expect(current.body).toBeNull();
      expect([abandon, retry, complete, replace, register].map((response) => response.status))
        .toEqual([404, 404, 404, 404, 404]);
      expect((await requestAs(app, owner).get("/api/contracts/ingest-runs/current")).body.id).toBe(runId);
    } finally {
      await db.delete(contractIngestCompletionsTable).where(eq(contractIngestCompletionsTable.runId, runId));
      await db.delete(contractIngestItemsTable).where(eq(contractIngestItemsTable.runId, runId));
      await db.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
      mocks.storedPdfs.clear();
    }
  });
});