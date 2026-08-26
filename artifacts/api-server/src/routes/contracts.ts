import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, contractsTable, registryViewsTable } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  CreateContractBody,
  UpdateContractBody,
  CreateRegistryViewBody,
  PinRegistryViewBody,
  ReorderRegistryViewsBody,
  UpdateRegistryViewBody,
} from "@workspace/api-zod";
import {
  extractContractFromText,
  extractReadablePdfText,
  extractScannedPdfText,
} from "../lib/contract-extraction";
import { UploadSource } from "../lib/contract-source";
import {
  enforceProvenanceConsistency,
  isRecord,
  registryViewResponse,
  responseFor,
  sanitizeChangedFields,
  upgradeContract,
  withComputedDates,
} from "../lib/contract-normalization";

const maximumUploadBytes = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumUploadBytes, files: 1 },
});

const router: IRouter = Router();

function uploadedHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function hasExistingSourceHash(hash: string) {
  const records = await db.select({ contract: contractsTable.contract }).from(contractsTable);
  return records.some((record) => {
    const contract = isRecord(record.contract) ? record.contract : {};
    const source = isRecord(contract.source) ? contract.source : {};
    return source.hash === hash;
  });
}

function contractDocumentType(contract: Record<string, any>) {
  const value = contract.fields?.documentType?.value;
  return typeof value === "string" ? value : null;
}

router.get("/registry-views", async (_req: Request, res: Response): Promise<void> => {
  const records = await db.select().from(registryViewsTable).orderBy(
    asc(sql`CASE WHEN ${registryViewsTable.pinnedAt} IS NULL THEN 1 ELSE 0 END`),
    asc(registryViewsTable.pinnedOrder),
    asc(registryViewsTable.pinnedAt),
    desc(registryViewsTable.updatedAt),
    asc(registryViewsTable.id),
  );
  res.json(records.map(registryViewResponse));
});

router.post("/registry-views", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateRegistryViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A view name and valid registry filters are required." });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "A view name is required." });
    return;
  }
  const [record] = await db.insert(registryViewsTable).values({
    name,
    search: parsed.data.search,
    documentType: parsed.data.documentType ?? null,
  }).returning();
  res.status(201).json(registryViewResponse(record));
});

router.put("/registry-views/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateRegistryViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A view name and valid registry filters are required." });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "A view name is required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [record] = await db.update(registryViewsTable)
    .set({
      name,
      search: parsed.data.search,
      documentType: parsed.data.documentType ?? null,
      updatedAt: new Date(),
    })
    .where(eq(registryViewsTable.id, id))
    .returning();
  if (!record) {
    res.status(404).json({ error: "Registry view not found." });
    return;
  }
  res.json(registryViewResponse(record));
});

router.patch("/registry-views/:id/pin", async (req: Request, res: Response): Promise<void> => {
  const parsed = PinRegistryViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid pin state is required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const record = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('registry_views_pinned_order'))`);
    const [existing] = await tx.select({
      id: registryViewsTable.id,
      pinnedAt: registryViewsTable.pinnedAt,
      pinnedOrder: registryViewsTable.pinnedOrder,
    }).from(registryViewsTable).where(eq(registryViewsTable.id, id));
    if (!existing) return null;

    let pinnedOrder = existing.pinnedOrder;
    if (parsed.data.pinned && existing.pinnedAt === null) {
      const [result] = await tx
        .select({ maxOrder: sql<number>`COALESCE(MAX(${registryViewsTable.pinnedOrder}), -1)` })
        .from(registryViewsTable)
        .where(isNotNull(registryViewsTable.pinnedAt));
      pinnedOrder = Number(result?.maxOrder ?? -1) + 1;
    }
    const [updated] = await tx.update(registryViewsTable)
      .set({
        pinnedAt: parsed.data.pinned ? (existing.pinnedAt ?? new Date()) : null,
        pinnedOrder: parsed.data.pinned ? pinnedOrder : null,
      })
      .where(eq(registryViewsTable.id, id))
      .returning();
    return updated;
  });
  if (!record) {
    res.status(404).json({ error: "Registry view not found." });
    return;
  }
  res.json(registryViewResponse(record));
});

router.patch("/registry-views/order", async (req: Request, res: Response): Promise<void> => {
  const parsed = ReorderRegistryViewsBody.safeParse(req.body);
  if (!parsed.success || new Set(parsed.data.orderedIds).size !== parsed.data.orderedIds.length) {
    res.status(400).json({ error: "A complete, unique order for pinned views is required." });
    return;
  }

  const records = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('registry_views_pinned_order'))`);
    const pinnedViews = await tx
      .select({ id: registryViewsTable.id })
      .from(registryViewsTable)
      .where(isNotNull(registryViewsTable.pinnedAt));
    const pinnedIds = new Set(pinnedViews.map((view) => view.id));
    if (
      parsed.data.orderedIds.length !== pinnedIds.size ||
      parsed.data.orderedIds.some((id) => !pinnedIds.has(id))
    ) {
      return null;
    }

    for (const [index, id] of parsed.data.orderedIds.entries()) {
      await tx
        .update(registryViewsTable)
        .set({ pinnedOrder: -(index + 1) })
        .where(eq(registryViewsTable.id, id));
    }
    for (const [index, id] of parsed.data.orderedIds.entries()) {
      await tx
        .update(registryViewsTable)
        .set({ pinnedOrder: index })
        .where(eq(registryViewsTable.id, id));
    }

    return tx.select().from(registryViewsTable).orderBy(
      asc(sql`CASE WHEN ${registryViewsTable.pinnedAt} IS NULL THEN 1 ELSE 0 END`),
      asc(registryViewsTable.pinnedOrder),
      asc(registryViewsTable.pinnedAt),
      desc(registryViewsTable.updatedAt),
      asc(registryViewsTable.id),
    );
  });
  if (!records) {
    res.status(400).json({ error: "The order must include every pinned view exactly once." });
    return;
  }
  res.json(records.map(registryViewResponse));
});

router.delete("/registry-views/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [record] = await db.delete(registryViewsTable)
    .where(eq(registryViewsTable.id, id))
    .returning({ id: registryViewsTable.id });
  if (!record) {
    res.status(404).json({ error: "Registry view not found." });
    return;
  }
  res.status(204).send();
});

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

router.post("/contracts/:id/alert/dismiss", async (req: Request, res: Response): Promise<void> => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 300) : "";
  if (!reason) {
    res.status(400).json({ error: "A reason is required to dismiss an alert." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [existing] = await db.select().from(contractsTable).where(eq(contractsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Contract not found." });
    return;
  }
  const contract = upgradeContract(existing.contract) as Record<string, any>;
  const alert = isRecord(contract.alert) ? contract.alert : null;
  if (!alert) {
    res.status(400).json({ error: "This contract has no actionable alert." });
    return;
  }
  const dismissed = { ...alert, state: "dismissed", dismissedReason: reason };
  const [record] = await db.update(contractsTable)
    .set({
      contract: {
        ...contract,
        alert: dismissed,
      },
      updatedAt: new Date(),
    })
    .where(eq(contractsTable.id, existing.id))
    .returning();
  res.json(responseFor(record));
});

router.put("/contracts/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateContractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid filename and provenance contract are required." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [existing] = await db.select().from(contractsTable).where(eq(contractsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Contract not found." });
    return;
  }
  const changedContract = sanitizeChangedFields(
      parsed.data.contract as unknown as Record<string, unknown>,
      upgradeContract(existing.contract) as unknown as Record<string, unknown>,
    );
  const contract = withComputedDates(changedContract);
  if (!enforceProvenanceConsistency(contract)) {
    res.status(400).json({ error: "Contract provenance is inconsistent with its field values." });
    return;
  }
  const [record] = await db
    .update(contractsTable)
    .set({
      filename: parsed.data.filename.slice(0, 250),
      parentContractId: null,
      documentType: contractDocumentType(contract),
      contract,
      confidence: {},
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
  const parsed = CreateContractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid filename and provenance contract are required." });
    return;
  }
  if (!enforceProvenanceConsistency(parsed.data.contract as unknown as Record<string, unknown>)) {
    res.status(400).json({ error: "Contract provenance is inconsistent with its field values." });
    return;
  }
  const sourceHash =
    isRecord(parsed.data.contract.source) && typeof parsed.data.contract.source.hash === "string"
      ? parsed.data.contract.source.hash
      : null;
  if (sourceHash && await hasExistingSourceHash(sourceHash)) {
    res.status(409).json({ error: "This contract has already been saved. Duplicate skipped." });
    return;
  }
  const contract = withComputedDates(parsed.data.contract as unknown as Record<string, unknown>);
  const [record] = await db.insert(contractsTable).values({
    id: randomUUID(),
    filename: parsed.data.filename.slice(0, 250),
    parentContractId: null,
    documentType: contractDocumentType(contract),
    contract,
    confidence: {},
  }).returning();
  res.status(201).json(responseFor(record));
});

export function isPdf(file: Express.Multer.File): boolean {
  return file.mimetype === "application/pdf" && file.buffer.subarray(0, 5).toString() === "%PDF-";
}

router.post(
  "/contracts/extract",
  upload.fields([
    { name: "files", maxCount: 20 },
    { name: "file", maxCount: 1 },
  ]),
  async (req: Request, res: Response): Promise<void> => {
    const uploadedFiles = Array.isArray(req.files)
      ? req.files
      : Object.values(req.files ?? {}).flat();
    const file = uploadedFiles[0];
    if (!file) {
      res.status(400).json({ error: "Choose one PDF contract or more to continue." });
      return;
    }

    if (uploadedFiles.some((candidate) => !isPdf(candidate))) {
      res.status(400).json({ error: "Only valid PDF files can be uploaded." });
      return;
    }

    const uploadSource = new UploadSource(
      uploadedFiles.map((candidate) => ({
        originalname: candidate.originalname,
        size: candidate.size,
        buffer: candidate.buffer,
        id: uploadedHash(candidate.buffer),
        hash: uploadedHash(candidate.buffer),
      })),
    );
    const sourceFiles = await uploadSource.list();
    if (await hasExistingSourceHash(sourceFiles[0].hash!)) {
      res.status(409).json({ error: "This contract has already been uploaded. Duplicate skipped." });
      return;
    }

    let text: string;
    let extractionSource: "text" | "ocr" = "text";
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
        extractionSource = "ocr";
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
        source: extractionSource,
        ocrConfidence,
        ...(extractionSource === "ocr" ? { ocrPageCount, ocrPagesProcessed } : {}),
      });
      if (result.extraction.contract) {
        result.extraction.contract.source = {
          ...sourceFiles[0],
          hash: sourceFiles[0].hash!,
        };
      }
      req.log.info({ bytes: file.size, hash: sourceFiles[0].hash }, "Contract extracted");
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
          extractionSource === "ocr" && ocrPageCount !== undefined
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