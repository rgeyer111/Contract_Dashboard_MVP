import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import {
  db,
  contractIngestCompletionsTable,
  contractIngestItemsTable,
  contractIngestObjectCleanupTable,
  contractIngestRunsTable,
  contractsTable,
  registryViewsTable,
} from "@workspace/db";
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
import {
  type ContractSource,
  loadContractSourceFile,
  UploadSource,
} from "../lib/contract-source";
import {
  enforceProvenanceConsistency,
  isRecord,
  registryViewResponse,
  responseFor,
  sanitizeChangedFields,
  upgradeContract,
  withComputedDates,
} from "../lib/contract-normalization";
import { readContractIngestPdf } from "../lib/contract-ingest-storage";
import {
  processContractIngestObjectCleanup,
  queueContractIngestObjectCleanup,
  reserveAndStoreContractIngestPdf,
} from "../lib/contract-ingest-cleanup";

const maximumUploadBytes = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumUploadBytes, files: 1 },
});
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumUploadBytes, files: 20 },
});

const router: IRouter = Router();

function uploadedHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function hasExistingSourceHash(hash: string) {
  const records = await db
    .select({ fileHash: contractsTable.fileHash, contract: contractsTable.contract })
    .from(contractsTable);
  return records.some((record) => {
    if (record.fileHash === hash) return true;
    const contract = isRecord(record.contract) ? record.contract : {};
    const source = isRecord(contract.source) ? contract.source : {};
    return source.hash === hash;
  });
}

function sourceHashForContract(contract: Record<string, unknown>) {
  return isRecord(contract.source) && typeof contract.source.hash === "string"
    ? contract.source.hash
    : null;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.code === "23505") return true;
  return isUniqueConstraintViolation(error.cause);
}

function contractDocumentType(contract: Record<string, any>) {
  const value = contract.fields?.documentType?.value;
  return typeof value === "string" ? value : null;
}

class ExtractionError extends Error {
  constructor(
    message: string,
    readonly status: 422 | 502,
  ) {
    super(message);
  }
}

function uploadSourceFor(file: Express.Multer.File): { source: ContractSource; id: string } {
  const id = uploadedHash(file.buffer);
  return {
    source: new UploadSource([{
      originalname: file.originalname,
      size: file.size,
      buffer: file.buffer,
      id,
      hash: id,
    }]),
    id,
  };
}

export async function extractSourceFile(
  source: ContractSource,
  id: string,
  req: Pick<Request, "log">,
): Promise<any> {
  const sourceFile = await loadContractSourceFile(source, id);
  if (await hasExistingSourceHash(sourceFile.hash)) {
    const error = new Error("This contract has already been uploaded. Duplicate skipped.");
    (error as Error & { status?: number }).status = 409;
    throw error;
  }

  let text: string;
  let extractionSource: "text" | "ocr" = "text";
  let ocrConfidence: "High" | "Medium" | "Low" | undefined;
  let ocrPageCount: number | undefined;
  let ocrPagesProcessed: number | undefined;
  try {
    text = await extractReadablePdfText(sourceFile.bytes);
  } catch (error) {
    req.log.warn({ err: error }, "Unable to read embedded PDF text; trying OCR");
    text = "";
  }

  if (text.length < 50) {
    try {
      const ocr = await extractScannedPdfText(sourceFile.bytes);
      text = ocr.text;
      extractionSource = "ocr";
      ocrConfidence = ocr.confidence;
      ocrPageCount = ocr.pageCount;
      ocrPagesProcessed = ocr.pagesProcessed;
      req.log.info(
        { bytes: sourceFile.size, ocrConfidence, ocrPageCount, ocrPagesProcessed },
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
        throw new ExtractionError(
          error instanceof Error
            ? error.message
            : "We could not fully transcribe this scanned PDF. Split it into smaller files and try again.",
          422,
        );
      }
      throw new ExtractionError(
        "We could not read text from this PDF, including with OCR. Make sure the scan is clear and try again.",
        422,
      );
    }
  }

  try {
    const result = await extractContractFromText(text, sourceFile.name, {
      source: extractionSource,
      ocrConfidence,
      ...(extractionSource === "ocr" ? { ocrPageCount, ocrPagesProcessed } : {}),
    });
    if (result.extraction.contract) {
      result.extraction.contract.source = {
        id: sourceFile.id,
        name: sourceFile.name,
        modifiedAt: sourceFile.modifiedAt,
        size: sourceFile.size,
        hash: sourceFile.hash,
      };
    }
    req.log.info({ bytes: sourceFile.size, hash: sourceFile.hash }, "Contract extracted");
    return result;
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
      throw new ExtractionError(
        `${error instanceof Error ? error.message : "This contract is too large to process."}${pageDetails}`,
        422,
      );
    }
    throw new ExtractionError(
      "We could not extract this contract right now. Please try again.",
      502,
    );
  }
}

async function extractUploadedFile(file: Express.Multer.File, req: Request): Promise<any> {
  const { source, id } = uploadSourceFor(file);
  return extractSourceFile(source, id, req);
}

function ingestHeaders(req: Request) {
  const runId = req.header("x-ingest-run-id") || (typeof req.body?.ingestRunId === "string" ? req.body.ingestRunId : undefined);
  const itemId = req.header("x-ingest-item-id") || (typeof req.body?.ingestItemId === "string" ? req.body.ingestItemId : undefined);
  return runId && itemId ? { runId, itemId } : null;
}

async function persistIngestStart(
  identifiers: { runId: string; itemId: string },
  file: Express.Multer.File,
): Promise<{ storagePath: string; processingAttemptId: string }> {
  const hash = uploadedHash(file.buffer);
  const storagePath = await reserveAndStoreContractIngestPdf(file.buffer);
  const processingAttemptId = randomUUID();
  let replacedStoragePath: string | null = null;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${identifiers.runId}))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${storagePath}))`);
      const [reservation] = await tx.select({ state: contractIngestObjectCleanupTable.state })
        .from(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
      if (reservation?.state !== "uploading") {
        throw new Error("Contract ingest upload reservation is no longer active.");
      }
      const [existing] = await tx.select({ storagePath: contractIngestItemsTable.storagePath })
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.id, identifiers.itemId));
      replacedStoragePath = existing?.storagePath ?? null;
      await tx.insert(contractIngestRunsTable)
        .values({ id: identifiers.runId })
        .onConflictDoNothing();
      await tx.insert(contractIngestItemsTable)
        .values({
          id: identifiers.itemId,
          runId: identifiers.runId,
          filename: file.originalname.slice(0, 250),
          size: file.size,
          hash,
          storagePath,
          state: "processing",
          processingAttemptId,
          message: null,
          extraction: null,
          handedOffAt: null,
        })
        .onConflictDoUpdate({
          target: contractIngestItemsTable.id,
          set: {
            runId: identifiers.runId,
            filename: file.originalname.slice(0, 250),
            size: file.size,
            hash,
            storagePath,
            state: "processing",
            processingAttemptId,
            message: null,
            extraction: null,
            handedOffAt: null,
            updatedAt: new Date(),
          },
        });
      await tx.delete(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
      if (replacedStoragePath && replacedStoragePath !== storagePath) {
        await tx.insert(contractIngestObjectCleanupTable)
          .values({
            storagePath: replacedStoragePath,
            state: "cleanup_pending",
          })
          .onConflictDoUpdate({
            target: contractIngestObjectCleanupTable.storagePath,
            set: {
              state: "cleanup_pending",
              updatedAt: new Date(),
            },
          });
      }
    });
  } catch (error) {
    await queueContractIngestObjectCleanup([storagePath]);
    await processContractIngestObjectCleanup([storagePath]);
    throw error;
  }
  if (replacedStoragePath && replacedStoragePath !== storagePath) {
    await processContractIngestObjectCleanup([replacedStoragePath]);
  }
  return { storagePath, processingAttemptId };
}

async function persistIngestOutcome(
  identifiers: { runId: string; itemId: string },
  outcome: { state: string; message: string | null; extraction: any | null },
  attempt: { storagePath: string; processingAttemptId: string },
) {
  const updated = await db.update(contractIngestItemsTable)
    .set({ ...outcome, processingAttemptId: null, updatedAt: new Date() })
    .where(and(
      eq(contractIngestItemsTable.id, identifiers.itemId),
      eq(contractIngestItemsTable.runId, identifiers.runId),
      eq(contractIngestItemsTable.state, "processing"),
      eq(contractIngestItemsTable.storagePath, attempt.storagePath),
      eq(contractIngestItemsTable.processingAttemptId, attempt.processingAttemptId),
    ))
    .returning({ id: contractIngestItemsTable.id });
  return updated.length > 0;
}

async function deleteRunIfNoActionableItems(runId: string) {
  const storagePaths = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
    const remaining = await tx.select({ id: contractIngestItemsTable.id })
      .from(contractIngestItemsTable)
      .where(and(
        eq(contractIngestItemsTable.runId, runId),
        sql`${contractIngestItemsTable.handedOffAt} IS NULL`,
        sql`${contractIngestItemsTable.state} IN ('ready', 'failed', 'processing')`,
      ));
    if (!remaining.length) {
      const items = await tx.select({ storagePath: contractIngestItemsTable.storagePath })
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.runId, runId));
      if (items.length) {
        await tx.insert(contractIngestObjectCleanupTable)
          .values(items.map((item) => ({
            storagePath: item.storagePath,
            state: "cleanup_pending",
          })))
          .onConflictDoUpdate({
            target: contractIngestObjectCleanupTable.storagePath,
            set: {
              state: "cleanup_pending",
              updatedAt: new Date(),
            },
          });
      }
      await tx.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
      return items.map((item) => item.storagePath);
    }
    return [];
  });
  if (storagePaths.length) await processContractIngestObjectCleanup(storagePaths);
}

function extractionErrorStatus(error: unknown) {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status
    : 502;
}

function extractionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "We could not extract this contract right now. Please try again.";
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
  if (!parsed.data.contract.assignment.owner.trim()) {
    res.status(400).json({ error: "A non-empty contract owner is required." });
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
  let record;
  try {
    [record] = await db
      .update(contractsTable)
      .set({
        filename: parsed.data.filename.slice(0, 250),
        fileHash: sourceHashForContract(contract) ?? existing.fileHash,
        documentType: contractDocumentType(contract),
        contract,
        confidence: {},
        updatedAt: new Date(),
      })
      .where(eq(contractsTable.id, id))
      .returning();
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      res.status(409).json({ error: "This contract has already been saved. Duplicate skipped." });
      return;
    }
    throw error;
  }
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
  if (!parsed.data.contract.assignment.owner.trim()) {
    res.status(400).json({ error: "A non-empty contract owner is required." });
    return;
  }
  if (!enforceProvenanceConsistency(parsed.data.contract as unknown as Record<string, unknown>)) {
    res.status(400).json({ error: "Contract provenance is inconsistent with its field values." });
    return;
  }
  const sourceHash = sourceHashForContract(parsed.data.contract as unknown as Record<string, unknown>);
  if (sourceHash && await hasExistingSourceHash(sourceHash)) {
    res.status(409).json({ error: "This contract has already been saved. Duplicate skipped." });
    return;
  }
  const contract = withComputedDates(parsed.data.contract as unknown as Record<string, unknown>);
  let record;
  try {
    [record] = await db.insert(contractsTable).values({
      id: randomUUID(),
      filename: parsed.data.filename.slice(0, 250),
      fileHash: sourceHash,
      documentType: contractDocumentType(contract),
      contract,
      confidence: {},
    }).returning();
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      res.status(409).json({ error: "This contract has already been saved. Duplicate skipped." });
      return;
    }
    throw error;
  }
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

    const identifiers = ingestHeaders(req);
    const ingestAttempt = identifiers ? await persistIngestStart(identifiers, file) : undefined;
    try {
      if (identifiers) {
        const [duplicateItem] = await db.select({ id: contractIngestItemsTable.id })
          .from(contractIngestItemsTable)
          .where(and(
            eq(contractIngestItemsTable.runId, identifiers.runId),
            ne(contractIngestItemsTable.id, identifiers.itemId),
            eq(contractIngestItemsTable.hash, uploadedHash(file.buffer)),
            eq(contractIngestItemsTable.state, "ready"),
          ))
          .limit(1);
        if (duplicateItem) {
          const duplicateError = new Error("This contract has already been uploaded. Duplicate skipped.");
          (duplicateError as Error & { status?: number }).status = 409;
          throw duplicateError;
        }
      }
      const result = await extractUploadedFile(file, req);
      if (identifiers && ingestAttempt) {
        result.ingestRunId = identifiers.runId;
        result.ingestItemId = identifiers.itemId;
        const persisted = await persistIngestOutcome(identifiers, {
          state: "ready",
          message: "Ready for review",
          extraction: result,
        }, ingestAttempt);
        if (!persisted) {
          res.status(409).json({ error: "This upload attempt was superseded. Use the latest result." });
          return;
        }
      }
      res.json(result);
    } catch (error) {
      const duplicate = extractionErrorStatus(error) === 409;
      if (identifiers && ingestAttempt) {
        const persisted = await persistIngestOutcome(identifiers, {
          state: duplicate ? "duplicate" : "failed",
          message: duplicate ? "Duplicate skipped" : extractionErrorMessage(error),
          extraction: null,
        }, ingestAttempt);
        if (!persisted) {
          res.status(409).json({ error: "This upload attempt was superseded. Use the latest result." });
          return;
        }
        if (duplicate) await deleteRunIfNoActionableItems(identifiers.runId);
      }
      res.status(duplicate ? 409 : extractionErrorStatus(error)).json({
        error: duplicate ? "This contract has already been uploaded. Duplicate skipped." : extractionErrorMessage(error),
      });
    }
  },
);

function ingestItemResponse(item: typeof contractIngestItemsTable.$inferSelect) {
  return {
    id: item.id,
    filename: item.filename,
    state: item.handedOffAt ? "ready" : item.state,
    message: item.message,
    extraction: item.extraction,
  };
}

router.post(
  "/contracts/ingest-runs",
  batchUpload.array("files", 20),
  async (req: Request, res: Response): Promise<void> => {
    const files = Array.isArray(req.files) ? req.files : [];
    const runId = typeof req.body?.runId === "string" ? req.body.runId : "";
    const rawItemIds = req.body?.itemIds;
    const itemIds = Array.isArray(rawItemIds)
      ? rawItemIds.filter((value): value is string => typeof value === "string")
      : typeof rawItemIds === "string"
        ? [rawItemIds]
        : [];
    if (!runId || !files.length || itemIds.length !== files.length) {
      res.status(400).json({ error: "A run ID and one item ID per PDF are required." });
      return;
    }
    if (files.some((file) => !isPdf(file))) {
      res.status(400).json({ error: "Only valid PDF files can be uploaded." });
      return;
    }
    const storedFiles: Array<{ file: Express.Multer.File; storagePath: string }> = [];
    try {
      for (const file of files) {
        storedFiles.push({ file, storagePath: await reserveAndStoreContractIngestPdf(file.buffer) });
      }
    } catch (error) {
      await queueContractIngestObjectCleanup(storedFiles.map(({ storagePath }) => storagePath));
      await processContractIngestObjectCleanup(storedFiles.map(({ storagePath }) => storagePath));
      throw error;
    }
    const replacedStoragePaths: string[] = [];
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
        await tx.insert(contractIngestRunsTable).values({ id: runId }).onConflictDoNothing();
        for (const [index, { file, storagePath }] of storedFiles.entries()) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${storagePath}))`);
          const [reservation] = await tx.select({ state: contractIngestObjectCleanupTable.state })
            .from(contractIngestObjectCleanupTable)
            .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
          if (reservation?.state !== "uploading") {
            throw new Error("Contract ingest upload reservation is no longer active.");
          }
          const [existing] = await tx.select({ storagePath: contractIngestItemsTable.storagePath })
            .from(contractIngestItemsTable)
            .where(eq(contractIngestItemsTable.id, itemIds[index]));
          if (existing && existing.storagePath !== storagePath) {
            replacedStoragePaths.push(existing.storagePath);
          }
          await tx.insert(contractIngestItemsTable).values({
            id: itemIds[index],
            runId,
            filename: file.originalname.slice(0, 250),
            size: file.size,
            hash: uploadedHash(file.buffer),
            storagePath,
            state: "failed",
            processingAttemptId: null,
            message: "Processing was interrupted. Retry this PDF.",
            extraction: null,
            handedOffAt: null,
          }).onConflictDoUpdate({
            target: contractIngestItemsTable.id,
            set: {
              runId,
              filename: file.originalname.slice(0, 250),
              size: file.size,
              hash: uploadedHash(file.buffer),
              storagePath,
              state: "failed",
              processingAttemptId: null,
              message: "Processing was interrupted. Retry this PDF.",
              extraction: null,
              handedOffAt: null,
              updatedAt: new Date(),
            },
          });
          await tx.delete(contractIngestObjectCleanupTable)
            .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
        }
        if (replacedStoragePaths.length) {
          await tx.insert(contractIngestObjectCleanupTable)
            .values(replacedStoragePaths.map((storagePath) => ({
              storagePath,
              state: "cleanup_pending",
            })))
            .onConflictDoUpdate({
              target: contractIngestObjectCleanupTable.storagePath,
              set: {
                state: "cleanup_pending",
                updatedAt: new Date(),
              },
            });
        }
      });
    } catch (error) {
      await queueContractIngestObjectCleanup(storedFiles.map(({ storagePath }) => storagePath));
      await processContractIngestObjectCleanup(storedFiles.map(({ storagePath }) => storagePath));
      throw error;
    }
    if (replacedStoragePaths.length) {
      await processContractIngestObjectCleanup(replacedStoragePaths);
    }
    const items = await db.select().from(contractIngestItemsTable)
      .where(eq(contractIngestItemsTable.runId, runId))
      .orderBy(asc(contractIngestItemsTable.createdAt));
    res.status(201).json({ id: runId, items: items.map(ingestItemResponse) });
  },
);

router.get("/contracts/ingest-runs/current", async (_req: Request, res: Response): Promise<void> => {
  await processContractIngestObjectCleanup();
  const [run] = await db.select().from(contractIngestRunsTable)
    .orderBy(desc(contractIngestRunsTable.updatedAt))
    .limit(1);
  if (!run) {
    res.json(null);
    return;
  }
  const items = await db.select().from(contractIngestItemsTable)
    .where(eq(contractIngestItemsTable.runId, run.id))
    .orderBy(asc(contractIngestItemsTable.createdAt));
  if (!items.length) {
    res.json(null);
    return;
  }
  res.json({ id: run.id, items: items.filter((item) => !item.handedOffAt).map(ingestItemResponse) });
});

router.delete("/contracts/ingest-runs/:runId", async (req: Request, res: Response): Promise<void> => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
    const [run] = await tx.select({ id: contractIngestRunsTable.id })
      .from(contractIngestRunsTable)
      .where(eq(contractIngestRunsTable.id, runId));
    if (!run) return null;
    const [processingItem] = await tx.select({ id: contractIngestItemsTable.id })
      .from(contractIngestItemsTable)
      .where(and(
        eq(contractIngestItemsTable.runId, runId),
        eq(contractIngestItemsTable.state, "processing"),
      ))
      .limit(1);
    if (processingItem) return { state: "processing" as const, storagePaths: [] };
    const items = await tx.select({ storagePath: contractIngestItemsTable.storagePath })
      .from(contractIngestItemsTable)
      .where(eq(contractIngestItemsTable.runId, runId));
    if (items.length) {
      await tx.insert(contractIngestObjectCleanupTable)
        .values(items.map((item) => ({
          storagePath: item.storagePath,
          state: "cleanup_pending",
        })))
        .onConflictDoUpdate({
          target: contractIngestObjectCleanupTable.storagePath,
          set: {
            state: "cleanup_pending",
            updatedAt: new Date(),
          },
        });
    }
    await tx.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
    return {
      state: "abandoned" as const,
      storagePaths: items.map((item) => item.storagePath),
    };
  });
  if (!outcome) {
    res.status(404).json({ error: "Ingest run not found." });
    return;
  }
  if (outcome.state === "processing") {
    res.status(409).json({ error: "Wait for active PDF processing to finish before abandoning this run." });
    return;
  }
  if (outcome.storagePaths.length) {
    await processContractIngestObjectCleanup(outcome.storagePaths);
  }
  res.status(204).send();
});

async function retryIngestItem(runId: string, itemId: string, req: Request) {
  const processingAttemptId = randomUUID();
  const item = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
    const [updated] = await tx.update(contractIngestItemsTable)
      .set({
        state: "processing",
        processingAttemptId,
        message: null,
        extraction: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(contractIngestItemsTable.id, itemId),
        eq(contractIngestItemsTable.runId, runId),
        eq(contractIngestItemsTable.state, "failed"),
        sql`${contractIngestItemsTable.handedOffAt} IS NULL`,
      ))
      .returning();
    return updated;
  });
  if (!item) {
    const [existing] = await db.select({ id: contractIngestItemsTable.id })
      .from(contractIngestItemsTable)
      .where(and(
        eq(contractIngestItemsTable.id, itemId),
        eq(contractIngestItemsTable.runId, runId),
      ));
    return existing
      ? { status: 409, error: "Only failed ingest items can be retried." }
      : null;
  }
  try {
    const bytes = await readContractIngestPdf(item.storagePath);
    const source = new UploadSource([{
      originalname: item.filename,
      size: item.size,
      buffer: bytes,
      id: item.hash,
      hash: item.hash,
    }]);
    const result = await extractSourceFile(source, item.hash, req);
    result.ingestRunId = runId;
    result.ingestItemId = itemId;
    const persisted = await persistIngestOutcome({ runId, itemId }, {
      state: "ready",
      message: "Ready for review",
      extraction: result,
    }, { storagePath: item.storagePath, processingAttemptId });
    if (!persisted) {
      return { status: 409, error: "This retry attempt was superseded. Use the latest result." };
    }
    return { result };
  } catch (error) {
    const duplicate = extractionErrorStatus(error) === 409;
    const persisted = await persistIngestOutcome({ runId, itemId }, {
      state: duplicate ? "duplicate" : "failed",
      message: duplicate ? "Duplicate skipped" : extractionErrorMessage(error),
      extraction: null,
    }, { storagePath: item.storagePath, processingAttemptId });
    if (!persisted) {
      return { status: 409, error: "This retry attempt was superseded. Use the latest result." };
    }
    if (duplicate) await deleteRunIfNoActionableItems(runId);
    return {
      status: duplicate ? 409 : extractionErrorStatus(error),
      error: duplicate ? "This contract has already been uploaded. Duplicate skipped." : extractionErrorMessage(error),
    };
  }
}

router.post("/contracts/ingest-runs/:runId/items/:itemId/retry", async (req: Request, res: Response): Promise<void> => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  const outcome = await retryIngestItem(runId, itemId, req);
  if (!outcome) {
    res.status(404).json({ error: "Ingest item not found." });
    return;
  }
  if ("error" in outcome) {
    res.status(outcome.status ?? 502).json({ error: outcome.error });
    return;
  }
  res.json(outcome.result);
});

router.post("/contracts/ingest-runs/:runId/items/:itemId/complete", async (req: Request, res: Response): Promise<void> => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  const completion = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
    const [completed] = await tx.select({ itemId: contractIngestCompletionsTable.itemId })
      .from(contractIngestCompletionsTable)
      .where(and(
        eq(contractIngestCompletionsTable.itemId, itemId),
        eq(contractIngestCompletionsTable.runId, runId),
      ));
    if (completed) return { status: "completed" as const, storagePaths: [] };
    const [updated] = await tx.update(contractIngestItemsTable)
      .set({ handedOffAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(contractIngestItemsTable.id, itemId),
        eq(contractIngestItemsTable.runId, runId),
        eq(contractIngestItemsTable.state, "ready"),
        sql`${contractIngestItemsTable.handedOffAt} IS NULL`,
      ))
      .returning();
    if (!updated) {
      const [existing] = await tx.select({ id: contractIngestItemsTable.id })
        .from(contractIngestItemsTable)
        .where(and(
          eq(contractIngestItemsTable.id, itemId),
          eq(contractIngestItemsTable.runId, runId),
        ));
      return existing
        ? { status: "invalid" as const, storagePaths: [] }
        : { status: "missing" as const, storagePaths: [] };
    }
    await tx.insert(contractIngestCompletionsTable)
      .values({ itemId, runId })
      .onConflictDoNothing();
    const remaining = await tx.select({ id: contractIngestItemsTable.id })
      .from(contractIngestItemsTable)
      .where(and(
        eq(contractIngestItemsTable.runId, runId),
        sql`${contractIngestItemsTable.handedOffAt} IS NULL`,
        sql`${contractIngestItemsTable.state} IN ('ready', 'failed', 'processing')`,
      ));
    if (!remaining.length) {
      const items = await tx.select({ storagePath: contractIngestItemsTable.storagePath })
        .from(contractIngestItemsTable)
        .where(eq(contractIngestItemsTable.runId, runId));
      if (items.length) {
        await tx.insert(contractIngestObjectCleanupTable)
          .values(items.map((item) => ({
            storagePath: item.storagePath,
            state: "cleanup_pending",
          })))
          .onConflictDoUpdate({
            target: contractIngestObjectCleanupTable.storagePath,
            set: {
              state: "cleanup_pending",
              updatedAt: new Date(),
            },
          });
      }
      await tx.delete(contractIngestRunsTable).where(eq(contractIngestRunsTable.id, runId));
      return { status: "completed" as const, storagePaths: items.map((item) => item.storagePath) };
    }
    return { status: "completed" as const, storagePaths: [] };
  });
  if (completion.status !== "completed") {
    res.status(completion.status === "invalid" ? 409 : 404).json({
      error: completion.status === "invalid" ? "Only ready ingest items can be completed." : "Ingest item not found.",
    });
    return;
  }
  if (completion.storagePaths.length) {
    await processContractIngestObjectCleanup(completion.storagePaths);
  }
  res.status(204).send();
});

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