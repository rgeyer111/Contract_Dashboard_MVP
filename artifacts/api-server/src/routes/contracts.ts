import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { desc, eq } from "drizzle-orm";
import { db, contractsTable } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  extractContractFromText,
  extractReadablePdfText,
  extractScannedPdfText,
} from "../lib/contract-extraction";

const maximumUploadBytes = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumUploadBytes, files: 1 },
});

const router: IRouter = Router();

const contractFields = [
  "vendor", "contractNumber", "contractName", "contractType", "contractValue",
  "startDate", "contractDuration", "endDate", "noticePeriod", "noticeDeadline",
  "negotiationBuffer", "owner", "status",
] as const;

function isContract(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseFor(record: typeof contractsTable.$inferSelect) {
  return {
    id: record.id,
    filename: record.filename,
    contract: record.contract,
    confidence: record.confidence,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

router.get("/contracts", async (_req: Request, res: Response): Promise<void> => {
  const records = await db.select().from(contractsTable).orderBy(desc(contractsTable.updatedAt));
  res.json(records.map(responseFor));
});

router.get("/contracts/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [record] = await db.select().from(contractsTable).where(eq(contractsTable.id, id));
  if (!record) {
    res.status(404).json({ error: "Contract not found." });
    return;
  }
  res.json(responseFor(record));
});

router.put("/contracts/:id", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { filename?: unknown; contract?: unknown; confidence?: unknown };
  if (typeof body.filename !== "string" || !isContract(body.contract) || !isContract(body.confidence)) {
    res.status(400).json({ error: "A filename, contract, and confidence are required." });
    return;
  }
  const contract = body.contract;
  const confidence = body.confidence;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (contractFields.some((field) => !(field in contract))) {
    res.status(400).json({ error: "The contract is missing required fields." });
    return;
  }
  const [record] = await db
    .update(contractsTable)
    .set({
      filename: body.filename.slice(0, 250),
      contract,
      confidence,
      updatedAt: new Date(),
    })
    .where(eq(contractsTable.id, id))
    .returning();
  if (!record) {
    res.status(404).json({ error: "Contract not found." });
    return;
  }
  res.json(responseFor(record));
});

router.post("/contracts", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { filename?: unknown; contract?: unknown; confidence?: unknown };
  if (typeof body.filename !== "string" || !isContract(body.contract) || !isContract(body.confidence)) {
    res.status(400).json({ error: "A filename, contract, and confidence are required." });
    return;
  }
  const contract = body.contract;
  const confidence = body.confidence;
  if (contractFields.some((field) => !(field in contract))) {
    res.status(400).json({ error: "The contract is missing required fields." });
    return;
  }
  const [record] = await db.insert(contractsTable).values({
    id: randomUUID(),
    filename: body.filename.slice(0, 250),
    contract,
    confidence,
  }).returning();
  res.status(201).json(responseFor(record));
});

export function isPdf(file: Express.Multer.File): boolean {
  return file.mimetype === "application/pdf" && file.buffer.subarray(0, 5).toString() === "%PDF-";
}

router.post(
  "/contracts/extract",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Choose one PDF contract to continue." });
      return;
    }

    if (!isPdf(file)) {
      res.status(400).json({ error: "Only valid PDF files can be uploaded." });
      return;
    }

    let text: string;
    let source: "text" | "ocr" = "text";
    let ocrConfidence: "High" | "Medium" | "Low" | undefined;
    let ocrPageCount: number | undefined;
    let ocrPagesProcessed: number | undefined;
    try {
      text = await extractReadablePdfText(file.buffer);
    } catch (error) {
      req.log.warn({ err: error }, "Unable to read embedded PDF text; trying OCR");
      text = "";
    }

    if (text.length < 50) {
      try {
        const ocr = await extractScannedPdfText(file.buffer);
        text = ocr.text;
        source = "ocr";
        ocrConfidence = ocr.confidence;
        ocrPageCount = ocr.pageCount;
        ocrPagesProcessed = ocr.pagesProcessed;
        req.log.info(
          { bytes: file.size, ocrConfidence, ocrPageCount, ocrPagesProcessed },
          "Scanned contract transcribed with OCR",
        );
      } catch (error) {
        req.log.warn({ err: error }, "Unable to OCR scanned PDF");
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "OCR_INCOMPLETE"
        ) {
          res.status(422).json({
            error:
              error instanceof Error
                ? error.message
                : "We could not fully transcribe this scanned PDF. Split it into smaller files and try again.",
          });
          return;
        }
        res.status(422).json({
          error: "We could not read text from this PDF, including with OCR. Make sure the scan is clear and try again.",
        });
        return;
      }
    }

    try {
      const result = await extractContractFromText(text, file.originalname, {
        source,
        ocrConfidence,
        ...(source === "ocr" ? { ocrPageCount, ocrPagesProcessed } : {}),
      });
      req.log.info({ bytes: file.size }, "Contract extracted");
      res.json(result);
    } catch (error) {
      req.log.error({ err: error }, "Contract extraction failed");
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "CONTRACT_TEXT_TOO_LONG"
      ) {
        const pageDetails =
          source === "ocr" && ocrPageCount !== undefined
            ? ` OCR completed all ${ocrPagesProcessed ?? ocrPageCount} of ${ocrPageCount} pages before stopping.`
            : "";
        res.status(422).json({
          error: `${error instanceof Error ? error.message : "This contract is too large to process."}${pageDetails}`,
        });
        return;
      }
      res.status(502).json({
        error: "We could not extract this contract right now. Please try again.",
      });
    }
  },
);

router.use(
  (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (error instanceof multer.MulterError) {
      req.log.warn({ code: error.code }, "Invalid contract upload");
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "PDF files must be 10 MB or smaller." });
        return;
      }
      res.status(400).json({ error: "Please upload one PDF contract at a time." });
      return;
    }
    next(error);
  },
);

export default router;