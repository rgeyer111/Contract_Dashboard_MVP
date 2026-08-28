import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  db,
  contractIngestCompletionsTable,
  contractDecisionsTable,
  contractIngestItemsTable,
  contractIngestObjectCleanupTable,
  contractIngestRunsTable,
  contractsTable,
  contractWasteAuditTable,
  contractWasteTable,
  registryViewsTable,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import {
  CreateContractBody,
  CompleteIngestItemBody,
  RecordContractDecisionBody,
  UpdateContractBody,
  CreateRegistryViewBody,
  PinRegistryViewBody,
  ReorderRegistryViewsBody,
  UpdateRegistryViewBody,
} from "@workspace/api-zod";
import {
  extractContractFromText,
  extractPdfTextWithRecovery,
  extractScannedPdfText,
  PdfRecoveryError,
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
import {
  copyContractPdfToWaste,
  deleteContractWastePdf,
  readContractIngestPdf,
  readContractWastePdf,
} from "../lib/contract-ingest-storage";
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

async function requireAdministrator(req: Request, res: Response, next: NextFunction): Promise<void> {
  const origin = req.header("origin");
  const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const expectedHost = forwardedHost || req.header("host");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || !expectedHost || originHost !== expectedHost) {
      res.status(403).json({ error: "Cross-origin administrator requests are not allowed." });
      return;
    }
  }
  if (process.env.NODE_ENV === "test" && req.header("x-test-user-role") === "admin") {
    res.locals.adminActorId = req.header("x-test-user-id") || "test-admin";
    next();
    return;
  }
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  const claims = sessionClaims as {
    metadata?: { role?: unknown };
    publicMetadata?: { role?: unknown };
  } | null;
  if (claims?.publicMetadata?.role === "admin" || claims?.metadata?.role === "admin") {
    res.locals.adminActorId = userId;
    next();
    return;
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    if (user.publicMetadata.role !== "admin") {
      res.status(403).json({ error: "Administrator access is required." });
      return;
    }
    res.locals.adminActorId = userId;
    next();
  } catch (error) {
    req.log.warn({ err: error, userId }, "Unable to verify contract waste administrator");
    res.status(503).json({ error: "Administrator access could not be verified. Please try again." });
  }
}

function wasteResponse(record: typeof contractWasteTable.$inferSelect) {
  return {
    id: record.id,
    filename: record.filename,
    vendorLegalName: record.vendorLegalName,
    contractTitle: record.contractTitle,
    contractNumber: record.contractNumber,
    deletedAt: record.deletedAt.toISOString(),
  };
}

async function purgeWasteRecord(
  record: typeof contractWasteTable.$inferSelect,
  actorId: string,
): Promise<boolean> {
  if (record.purgedAt) return false;
  await deleteContractWastePdf(record.storagePath);
  return db.transaction(async (tx) => {
    const [purged] = await tx.update(contractWasteTable)
      .set({ purgedAt: new Date() })
      .where(and(eq(contractWasteTable.id, record.id), sql`${contractWasteTable.purgedAt} IS NULL`))
      .returning({ id: contractWasteTable.id });
    if (!purged) return false;
    await tx.insert(contractWasteAuditTable)
      .values({ wasteId: record.id, action: "purged", actorId })
      .onConflictDoNothing();
    return true;
  });
}

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

function decisionResponse(record: typeof contractDecisionsTable.$inferSelect) {
  return {
    id: record.id,
    contractId: record.contractId,
    decision: record.decision,
    actor: record.actor,
    snoozeUntil: record.snoozeUntil,
    decidedAt: record.decidedAt.toISOString(),
  };
}

class ExtractionError extends Error {
  constructor(
    message: string,
    readonly status: 422 | 502,
    readonly code:
      | "UNREADABLE"
      | "OCR_INCOMPLETE"
      | "TOO_LARGE"
      | "UNAVAILABLE"
      | "PDF_ENCRYPTED"
      | "PDF_UNREADABLE"
      | "PDF_REPAIR_FAILED"
      | "PDF_TOOL_UNAVAILABLE",
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
    const error = new Error("This contract has already been uploaded. Duplicate skipped.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = 409;
    error.code = "DUPLICATE";
    throw error;
  }

  let text: string;
  let extractionSource: "text" | "ocr" = "text";
  let ocrConfidence: "High" | "Medium" | "Low" | undefined;
  let ocrPageCount: number | undefined;
  let ocrPagesProcessed: number | undefined;
  try {
    const embedded = await extractPdfTextWithRecovery(sourceFile.bytes);
    text = embedded.text;
    if (embedded.repaired) {
      req.log.info(
        { bytes: sourceFile.size, hash: sourceFile.hash },
        "Recovered embedded PDF text from a temporary normalized copy",
      );
    }
  } catch (error) {
    if (error instanceof PdfRecoveryError) {
      req.log.warn({ err: error, code: error.code }, "Embedded PDF text recovery failed");
      throw new ExtractionError(
        error.message,
        error.code === "PDF_TOOL_UNAVAILABLE" ? 502 : 422,
        error.code,
      );
    }
    req.log.error({ err: error }, "Embedded PDF text recovery failed unexpectedly");
    throw new ExtractionError(
      "PDF repair is temporarily unavailable. Please try again later.",
      502,
      "PDF_TOOL_UNAVAILABLE",
    );
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
          "OCR_INCOMPLETE",
        );
      }
      throw new ExtractionError(
        "We could not read text from this PDF, including with OCR. Make sure the scan is clear and try again.",
        422,
        "UNREADABLE",
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
        "TOO_LARGE",
      );
    }
    throw new ExtractionError(
      "We could not extract this contract right now. Please try again.",
      502,
      "UNAVAILABLE",
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

function extractionErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNAVAILABLE";
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

router.delete("/contracts/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  let deleted;
  try {
    deleted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${id}))`);
      const [existing] = await tx.select({
        id: contractsTable.id,
        sourceStoragePath: contractsTable.sourceStoragePath,
        filename: contractsTable.filename,
        contract: contractsTable.contract,
      }).from(contractsTable).where(eq(contractsTable.id, id));
      if (!existing) return undefined;

      if (existing.sourceStoragePath) {
        await copyContractPdfToWaste(existing.sourceStoragePath, existing.id);
      }

      await tx.update(contractsTable)
        .set({ parentContractId: null, updatedAt: new Date() })
        .where(eq(contractsTable.parentContractId, id));
      const [record] = await tx.delete(contractsTable)
        .where(eq(contractsTable.id, id))
        .returning({ id: contractsTable.id, sourceStoragePath: contractsTable.sourceStoragePath });
      if (record) {
        await tx.delete(contractIngestCompletionsTable)
          .where(eq(contractIngestCompletionsTable.contractId, id));
      }
      if (record?.sourceStoragePath) {
        const contract = isRecord(existing.contract) ? existing.contract : {};
        const fields = isRecord(contract.fields) ? contract.fields : {};
        const fieldValue = (key: string) => {
          const field = isRecord(fields[key]) ? fields[key] : {};
          return typeof field.value === "string" && field.value.trim() ? field.value.trim() : null;
        };
        await tx.insert(contractWasteTable).values({
          id,
          storagePath: `/objects/uploads/contract-waste/${id}.pdf`,
          filename: existing.filename,
          vendorLegalName: fieldValue("vendorLegalName"),
          contractTitle: fieldValue("contractTitle"),
          contractNumber: fieldValue("contractNumber"),
        }).onConflictDoNothing();
        await tx.insert(contractIngestObjectCleanupTable)
          .values({ storagePath: record.sourceStoragePath, state: "cleanup_pending" })
          .onConflictDoUpdate({
            target: contractIngestObjectCleanupTable.storagePath,
            set: { state: "cleanup_pending", updatedAt: new Date() },
          });
      }
      return record;
    });
  } catch (error) {
    req.log.warn({ err: error, contractId: id }, "Unable to preserve contract PDF in waste storage");
    res.status(503).json({ error: "The contract could not be deleted because its PDF could not be moved to waste. Please try again." });
    return;
  }
  if (!deleted) {
    res.status(404).json({ error: "Contract not found." });
    return;
  }
  if (deleted.sourceStoragePath) {
    await processContractIngestObjectCleanup([deleted.sourceStoragePath]).catch((error) => {
      req.log.warn({ err: error, contractId: id }, "Contract source cleanup will be retried");
    });
  }
  res.status(204).send();
});

router.get("/admin/contract-waste", requireAdministrator, async (_req: Request, res: Response): Promise<void> => {
  const records = await db.select().from(contractWasteTable)
    .where(sql`${contractWasteTable.purgedAt} IS NULL`)
    .orderBy(desc(contractWasteTable.deletedAt), asc(contractWasteTable.id));
  res.json(records.map(wasteResponse));
});

router.get("/admin/contract-waste/:id", requireAdministrator, async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [record] = await db.select().from(contractWasteTable)
    .where(and(eq(contractWasteTable.id, id), sql`${contractWasteTable.purgedAt} IS NULL`));
  if (!record) {
    res.status(404).json({ error: "Waste file not found." });
    return;
  }
  try {
    const pdf = await readContractWastePdf(record.storagePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${record.filename.replace(/[\"\\r\\n]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (error) {
    req.log.warn({ err: error, wasteId: id }, "Unable to read contract waste PDF");
    res.status(404).json({ error: "Waste file not found." });
  }
});

router.delete("/admin/contract-waste/:id", requireAdministrator, async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [record] = await db.select().from(contractWasteTable).where(eq(contractWasteTable.id, id));
  if (record) await purgeWasteRecord(record, String(res.locals.adminActorId));
  res.status(204).send();
});

router.delete("/admin/contract-waste", requireAdministrator, async (_req: Request, res: Response): Promise<void> => {
  const records = await db.select().from(contractWasteTable)
    .where(sql`${contractWasteTable.purgedAt} IS NULL`)
    .orderBy(asc(contractWasteTable.id));
  let purgedCount = 0;
  for (const record of records) {
    if (await purgeWasteRecord(record, String(res.locals.adminActorId))) purgedCount += 1;
  }
  res.json({ purgedCount });
});

router.get("/contracts/:id/decisions", async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [contract] = await db.select({ id: contractsTable.id }).from(contractsTable).where(eq(contractsTable.id, id));
  if (!contract) {
    res.status(404).json({ error: "Contract not found." });
    return;
  }
  const decisions = await db.select()
    .from(contractDecisionsTable)
    .where(eq(contractDecisionsTable.contractId, id))
    .orderBy(desc(contractDecisionsTable.decidedAt));
  res.json(decisions.map(decisionResponse));
});

router.post("/contracts/:id/decisions", async (req: Request, res: Response): Promise<void> => {
  const parsed = RecordContractDecisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid decision and identify who made it." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [contract] = await db.select({ id: contractsTable.id }).from(contractsTable).where(eq(contractsTable.id, id));
  if (!contract) {
    res.status(404).json({ error: "Contract not found." });
    return;
  }
  const actor = parsed.data.actor.trim();
  const snoozeUntil = parsed.data.snoozeUntil
    ? parsed.data.snoozeUntil.toISOString().slice(0, 10)
    : null;
  const today = new Date().toISOString().slice(0, 10);
  if (!actor) {
    res.status(400).json({ error: "Identify who made this decision." });
    return;
  }
  if (parsed.data.decision === "snooze" && (!snoozeUntil || snoozeUntil < today)) {
    res.status(400).json({ error: "Choose today or a future date to snooze this decision." });
    return;
  }
  const [decision] = await db.insert(contractDecisionsTable).values({
    contractId: id,
    decision: parsed.data.decision,
    actor,
    snoozeUntil: parsed.data.decision === "snooze" ? snoozeUntil : null,
  }).returning();
  res.status(201).json(decisionResponse(decision));
});

router.get("/contracts/:id/source", async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [contract] = await db.select({
    filename: contractsTable.filename,
    sourceStoragePath: contractsTable.sourceStoragePath,
  }).from(contractsTable).where(eq(contractsTable.id, id));
  if (!contract?.sourceStoragePath) {
    res.status(404).json({ error: "The source PDF is not available for this contract." });
    return;
  }
  try {
    const pdf = await readContractIngestPdf(contract.sourceStoragePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${contract.filename.replace(/[\"\\r\\n]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (error) {
    req.log.warn({ err: error, contractId: id }, "Unable to read saved contract source PDF");
    res.status(404).json({ error: "The source PDF is no longer available." });
  }
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
      res.status(400).json({ error: "Choose one PDF contract or more to continue.", code: "INVALID_UPLOAD" });
      return;
    }

    if (uploadedFiles.some((candidate) => !isPdf(candidate))) {
      res.status(400).json({ error: "Only valid PDF files can be uploaded.", code: "INVALID_UPLOAD" });
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
          const duplicateError = new Error("This contract has already been uploaded. Duplicate skipped.") as Error & {
            status?: number;
            code?: string;
          };
          duplicateError.status = 409;
          duplicateError.code = "DUPLICATE";
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
          res.status(409).json({ error: "This upload attempt was superseded. Use the latest result.", code: "SUPERSEDED" });
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
          res.status(409).json({ error: "This upload attempt was superseded. Use the latest result.", code: "SUPERSEDED" });
          return;
        }
        if (duplicate) await deleteRunIfNoActionableItems(identifiers.runId);
      }
      res.status(duplicate ? 409 : extractionErrorStatus(error)).json({
        error: duplicate ? "This contract has already been uploaded. Duplicate skipped." : extractionErrorMessage(error),
        code: duplicate ? "DUPLICATE" : extractionErrorCode(error),
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
      ? { status: 409, error: "Only failed ingest items can be retried.", code: "INVALID_UPLOAD" }
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
      return { status: 409, error: "This retry attempt was superseded. Use the latest result.", code: "SUPERSEDED" };
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
      return { status: 409, error: "This retry attempt was superseded. Use the latest result.", code: "SUPERSEDED" };
    }
    if (duplicate) await deleteRunIfNoActionableItems(runId);
    return {
      status: duplicate ? 409 : extractionErrorStatus(error),
      error: duplicate ? "This contract has already been uploaded. Duplicate skipped." : extractionErrorMessage(error),
      code: duplicate ? "DUPLICATE" : extractionErrorCode(error),
    };
  }
}

router.post("/contracts/ingest-runs/:runId/items/:itemId/retry", async (req: Request, res: Response): Promise<void> => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  const outcome = await retryIngestItem(runId, itemId, req);
  if (!outcome) {
    res.status(404).json({ error: "Ingest item not found.", code: "INVALID_UPLOAD" });
    return;
  }
  if ("error" in outcome) {
    res.status(outcome.status ?? 502).json({ error: outcome.error, code: outcome.code ?? "UNAVAILABLE" });
    return;
  }
  res.json(outcome.result);
});

router.post("/contracts/ingest-runs/:runId/items/:itemId/complete", async (req: Request, res: Response): Promise<void> => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  const parsedCompletion = CompleteIngestItemBody.safeParse(req.body);
  if (!parsedCompletion.success) {
    res.status(400).json({ error: "A valid saved contract is required to preserve the source PDF." });
    return;
  }
  const contractId = parsedCompletion.data.contractId;
  const completion = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
    const [completed] = await tx.select({
      itemId: contractIngestCompletionsTable.itemId,
      contractId: contractIngestCompletionsTable.contractId,
      storagePath: contractIngestCompletionsTable.storagePath,
    })
      .from(contractIngestCompletionsTable)
      .where(and(
        eq(contractIngestCompletionsTable.itemId, itemId),
        eq(contractIngestCompletionsTable.runId, runId),
      ));
    if (completed) {
      if (completed.contractId !== contractId || !completed.storagePath) {
        return { status: "invalid_contract" as const, storagePaths: [] };
      }
      const [savedContract] = await tx.select({
        id: contractsTable.id,
        sourceStoragePath: contractsTable.sourceStoragePath,
      }).from(contractsTable).where(eq(contractsTable.id, contractId));
      if (!savedContract || (savedContract.sourceStoragePath && savedContract.sourceStoragePath !== completed.storagePath)) {
        return { status: "invalid_contract" as const, storagePaths: [] };
      }
      if (!savedContract.sourceStoragePath) {
        await tx.update(contractsTable)
          .set({ sourceStoragePath: completed.storagePath, updatedAt: new Date() })
          .where(eq(contractsTable.id, contractId));
      }
      await tx.delete(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, completed.storagePath));
      return { status: "completed" as const, storagePaths: [] };
    }
    const [item] = await tx.select({
      id: contractIngestItemsTable.id,
      hash: contractIngestItemsTable.hash,
      storagePath: contractIngestItemsTable.storagePath,
      state: contractIngestItemsTable.state,
    }).from(contractIngestItemsTable).where(and(
      eq(contractIngestItemsTable.id, itemId),
      eq(contractIngestItemsTable.runId, runId),
    ));
    if (!item) return { status: "missing" as const, storagePaths: [] };
    if (item.state !== "ready") {
      return { status: "invalid" as const, storagePaths: [] };
    }
    const [savedContract] = await tx.select({
      id: contractsTable.id,
      fileHash: contractsTable.fileHash,
    }).from(contractsTable).where(eq(contractsTable.id, contractId));
    if (!savedContract || savedContract.fileHash !== item.hash) {
      return { status: "invalid_contract" as const, storagePaths: [] };
    }
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
      return { status: "invalid" as const, storagePaths: [] };
    }
    await tx.update(contractsTable)
      .set({ sourceStoragePath: item.storagePath, updatedAt: new Date() })
      .where(eq(contractsTable.id, contractId));
    await tx.delete(contractIngestObjectCleanupTable)
      .where(eq(contractIngestObjectCleanupTable.storagePath, item.storagePath));
    await tx.insert(contractIngestCompletionsTable)
      .values({ itemId, runId, contractId, storagePath: item.storagePath })
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
      const linkedPaths = items.length
        ? await tx.select({ storagePath: contractsTable.sourceStoragePath })
          .from(contractsTable)
          .where(inArray(contractsTable.sourceStoragePath, items.map((item) => item.storagePath)))
        : [];
      const retained = new Set(linkedPaths.flatMap((row) => row.storagePath ? [row.storagePath] : []));
      const cleanupItems = items.filter((item) => !retained.has(item.storagePath));
      if (cleanupItems.length) {
        await tx.insert(contractIngestObjectCleanupTable)
          .values(cleanupItems.map((item) => ({
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
      return { status: "completed" as const, storagePaths: cleanupItems.map((item) => item.storagePath) };
    }
    return { status: "completed" as const, storagePaths: [] };
  });
  if (completion.status !== "completed") {
    res.status(completion.status === "missing" ? 404 : 409).json({
      error: completion.status === "invalid_contract"
        ? "The saved contract does not match this ingest item."
        : completion.status === "invalid"
          ? "Only ready ingest items can be completed."
          : "Ingest item not found.",
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
        res.status(400).json({ error: "PDF files must be 10 MB or smaller.", code: "TOO_LARGE" });
        return;
      }
      res.status(400).json({ error: "Please upload one PDF contract at a time.", code: "INVALID_UPLOAD" });
      return;
    }
    next(error);
  },
);

export default router;