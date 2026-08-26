import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { desc, eq } from "drizzle-orm";
import { db, contractsTable } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  CreateContractBody,
  UpdateContractBody,
} from "@workspace/api-zod";
import {
  extractContractFromText,
  extractReadablePdfText,
  extractScannedPdfText,
} from "../lib/contract-extraction";
import { computeContractDates, computeContractAlert } from "../lib/contract-computation";
import { UploadSource } from "../lib/contract-source";

const maximumUploadBytes = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumUploadBytes, files: 1 },
});

const router: IRouter = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const missing = (note: string | null = null) => ({
  value: null,
  status: "not_found" as const,
  confidence: "low" as const,
  page: null,
  clause: null,
  quote: null,
  note,
});

function legacyField(value: unknown, note = "Legacy saved value; source evidence was not retained.") {
  return value === null || value === undefined || value === ""
    ? missing()
    : {
        value,
        status: "ambiguous" as const,
        confidence: "low" as const,
        page: null,
        clause: null,
        quote: null,
        note,
      };
}

function parseLegacyPeriod(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^\s*(\d+)\s+(days?|weeks?|months?|years?)\s*$/i.exec(value);
  if (!match) return null;
  return {
    amount: Number(match[1]),
    unit: match[2].toLowerCase().replace(/s$/, "") + "s",
  };
}

const reviewerEditNote = "Reviewer-supplied value; original extraction evidence was cleared.";

function valuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function enforceProvenanceConsistency(contract: Record<string, unknown>) {
  const fields = isRecord(contract.fields) ? contract.fields : {};
  for (const field of Object.values(fields)) {
    if (!isRecord(field)) continue;
    if (field.status === "found" && (field.page === null || !field.quote)) return false;
    if (field.status === "not_found" && field.value !== null) return false;
  }
  return true;
}

function sanitizeChangedFields(
  incoming: Record<string, unknown>,
  previous: Record<string, unknown>,
) {
  const incomingFields = isRecord(incoming.fields) ? incoming.fields : {};
  const previousFields = isRecord(previous.fields) ? previous.fields : {};
  const fields = Object.fromEntries(
    Object.entries(incomingFields).map(([key, rawField]) => {
      const field = isRecord(rawField) ? rawField : {};
      const previousField = isRecord(previousFields[key]) ? previousFields[key] : {};
      if (valuesMatch(field.value, previousField.value)) return [key, rawField];
      return [
        key,
        {
          ...field,
          status: "ambiguous",
          confidence: "low",
          page: null,
          clause: null,
          quote: null,
          note: reviewerEditNote,
        },
      ];
    }),
  );
  return { ...incoming, fields };
}

function withComputedDates(value: Record<string, unknown>) {
  const assignment = isRecord(value.assignment) ? value.assignment : {};
  const contract = {
    ...value,
    assignment: {
      ...assignment,
      ownerEmail:
        typeof assignment.ownerEmail === "string" && assignment.ownerEmail
          ? assignment.ownerEmail
          : "john.doe@example.com",
      negotiationBufferSource:
        assignment.negotiationBufferSource === "contract_override" ||
        assignment.negotiationBufferSource === "contract_type_default"
          ? assignment.negotiationBufferSource
          : "global_default",
    },
  };
  return {
    ...contract,
    computed: computeContractDates(
      contract as unknown as {
        fields: Record<string, unknown>;
        assignment: { negotiationBufferDays: number };
      },
    ),
    alert: computeContractAlert(
      computeContractDates(
        contract as unknown as {
          fields: Record<string, unknown>;
          assignment: { negotiationBufferDays: number };
        },
      ),
      contract.assignment as unknown as { owner: string; ownerEmail: string },
      isRecord(value.alert) ? value.alert as any : null,
    ),
  };
}

function upgradeContract(value: unknown) {
  if (isRecord(value) && isRecord(value.fields) && isRecord(value.assignment)) {
    const upgraded = withComputedDates(value);
    const upgradedCanonical = CreateContractBody.safeParse({
      filename: "legacy-upgrade.pdf",
      contract: upgraded,
    });
    if (upgradedCanonical.success) return upgradedCanonical.data.contract;
  }
  const canonical = CreateContractBody.safeParse({ filename: "legacy-upgrade.pdf", contract: value });
  if (canonical.success) {
    return withComputedDates(canonical.data.contract as unknown as Record<string, unknown>);
  }
  const legacy = isRecord(value) ? value : {};
  const legacyType = {
    Maintenance: "maintenance",
    "Software License": "software_license",
    "Real Estate": "real_estate",
    Infrastructure: "infrastructure",
  }[String(legacy.contractType)] ?? null;
  const oldValue = isRecord(legacy.contractValue) ? legacy.contractValue : {};
  const statedValue =
    oldValue.status === "stated" &&
    typeof oldValue.amount === "number" &&
    typeof oldValue.currency === "string"
      ? {
          amount: oldValue.amount,
          currency: oldValue.currency.toUpperCase(),
          basis: "variable" as const,
        }
      : null;
  const notice = parseLegacyPeriod(legacy.noticePeriod);

  return withComputedDates({
    fields: {
      documentType: missing(),
      documentLanguage: missing(),
      vendorLegalName: legacyField(legacy.vendor),
      buyerLegalEntity: missing(),
      contractTitle: legacyField(legacy.contractName),
      contractNumber: legacyField(legacy.contractNumber),
      contractType: legacyField(legacyType),
      signatureDate: missing(),
      effectiveDate: legacyField(legacy.startDate),
      initialTermLength: legacyField(parseLegacyPeriod(legacy.contractDuration)),
      initialTermEndDate: legacyField(legacy.endDate),
      renewalMechanism: missing(),
      renewalTermLength: missing(),
      noticePeriod: legacyField(
        notice ? { ...notice, anchor: "unknown" as const, purpose: "non_renewal" as const } : null,
      ),
      noticeDeadline: legacyField(legacy.noticeDeadline),
      noticeDelivery: missing(),
      contractValue: legacyField(statedValue),
      billingFrequency: missing(),
    },
    assignment: {
      owner: typeof legacy.owner === "string" && legacy.owner ? legacy.owner : "John Doe",
      ownerEmail: "john.doe@example.com",
      negotiationBufferDays: parseLegacyPeriod(legacy.negotiationBuffer)?.amount ?? 30,
      negotiationBufferSource: "global_default",
      status: ["At Risk", "Review Open", "In Negotiation"].includes(String(legacy.status))
        ? legacy.status
        : "Review Open",
    },
  });
}

function documentEffectiveDate(record: typeof contractsTable.$inferSelect) {
  const contract = upgradeContract(record.contract) as Record<string, any>;
  const value = contract.fields?.effectiveDate?.value;
  return typeof value === "string" ? value : null;
}

function familyRootId(record: typeof contractsTable.$inferSelect, byId: Map<string, typeof contractsTable.$inferSelect>) {
  const visited = new Set<string>();
  let current = record;
  while (current.parentContractId && byId.has(current.parentContractId) && !visited.has(current.id)) {
    visited.add(current.id);
    current = byId.get(current.parentContractId)!;
  }
  return current.id;
}

function familyFor(record: typeof contractsTable.$inferSelect, records: Array<typeof contractsTable.$inferSelect>) {
  const byId = new Map(records.map((candidate) => [candidate.id, candidate]));
  const rootId = familyRootId(record, byId);
  const members = records
    .filter((candidate) => familyRootId(candidate, byId) === rootId)
    .sort((left, right) => {
      const leftDate = documentEffectiveDate(left) ?? "9999-12-31";
      const rightDate = documentEffectiveDate(right) ?? "9999-12-31";
      return leftDate.localeCompare(rightDate) || left.createdAt.getTime() - right.createdAt.getTime();
    });
  const root = byId.get(rootId)!;
  const effective = upgradeContract(root.contract) as Record<string, any>;
  const storedRoot = isRecord(root.contract) ? root.contract : {};
  const previousFamilyAlert = isRecord(storedRoot.familyAlert)
    ? storedRoot.familyAlert
    : effective.alert;
  const fieldKeys = ["vendorLegalName", "contractValue", "noticePeriod", "renewalMechanism", "initialTermEndDate"];

  for (const member of members) {
    const memberContract = upgradeContract(member.contract) as Record<string, any>;
    for (const [key, field] of Object.entries(memberContract.fields ?? {})) {
      if (isRecord(field) && field.value !== null && field.status !== "not_found") {
        effective.fields[key] = field;
      }
    }
  }
  const effectiveContract = withComputedDates({
    ...effective,
    alert: previousFamilyAlert,
  });
  const currentId = members.at(-1)?.id ?? rootId;

  return {
    id: rootId,
    documentCount: members.length,
    effectiveContract,
    documents: members.map((member) => {
      const contract = upgradeContract(member.contract) as Record<string, any>;
      return {
        id: member.id,
        filename: member.filename,
        documentType: member.documentType ?? contract.fields?.documentType?.value ?? null,
        effectiveDate: documentEffectiveDate(member),
        isParent: member.id === rootId,
        isCurrent: member.id === currentId,
        fieldValues: Object.fromEntries(
          fieldKeys.map((key) => [key, {
            value: contract.fields?.[key]?.value ?? null,
            sourceDocumentId: member.id,
            sourceFilename: member.filename,
          }]),
        ),
      };
    }),
  };
}

function responseFor(record: typeof contractsTable.$inferSelect, records: Array<typeof contractsTable.$inferSelect>) {
  const contract = upgradeContract(record.contract) as Record<string, any>;
  return {
    id: record.id,
    filename: record.filename,
    parentContractId: record.parentContractId,
    documentType: record.documentType ?? contract.fields?.documentType?.value ?? null,
    family: familyFor(record, records),
    contract,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

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

async function validateParentContractId(parentContractId: string | null | undefined, currentId?: string) {
  if (!parentContractId) return null;
  if (parentContractId === currentId) return "A contract cannot be its own parent.";
  if (currentId) {
    const [dependent] = await db
      .select({ id: contractsTable.id })
      .from(contractsTable)
      .where(eq(contractsTable.parentContractId, currentId))
      .limit(1);
    if (dependent) return "A root agreement with related documents cannot be reparented.";
  }
  const [parent] = await db
    .select({ id: contractsTable.id, parentContractId: contractsTable.parentContractId })
    .from(contractsTable)
    .where(eq(contractsTable.id, parentContractId));
  if (!parent) return "The selected parent contract was not found.";
  if (parent.parentContractId) return "Related documents must link directly to a root agreement.";
  return null;
}

function contractDocumentType(contract: Record<string, any>) {
  const value = contract.fields?.documentType?.value;
  return typeof value === "string" ? value : null;
}

router.get("/contracts", async (_req: Request, res: Response): Promise<void> => {
  const records = await db.select().from(contractsTable).orderBy(desc(contractsTable.updatedAt));
  res.json(records.map((record) => responseFor(record, records)));
});

router.get("/contracts/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [record] = await db.select().from(contractsTable).where(eq(contractsTable.id, id));
  if (!record) {
    res.status(404).json({ error: "Contract not found." });
    return;
  }
  const records = await db.select().from(contractsTable);
  res.json(responseFor(record, records));
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
  const records = await db.select().from(contractsTable);
  const family = familyFor(existing, records);
  const alert = isRecord(family.effectiveContract.alert) ? family.effectiveContract.alert : null;
  if (!alert) {
    res.status(400).json({ error: "This contract has no actionable alert." });
    return;
  }
  const dismissed = { ...alert, state: "dismissed", dismissedReason: reason };
  const root = records.find((record) => record.id === family.id)!;
  const rootContract = upgradeContract(root.contract) as unknown as Record<string, unknown>;
  await db.update(contractsTable)
    .set({
      contract: {
        ...rootContract,
        alert: dismissed,
        familyAlert: dismissed,
      },
      updatedAt: new Date(),
    })
    .where(eq(contractsTable.id, root.id))
    .returning();
  const updatedRecords = await db.select().from(contractsTable);
  const updatedRecord = updatedRecords.find((record) => record.id === id)!;
  res.json(responseFor(updatedRecord, updatedRecords));
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
  const storedContract = isRecord(existing.contract) ? existing.contract : {};
  const changedContract = sanitizeChangedFields(
      parsed.data.contract as unknown as Record<string, unknown>,
      upgradeContract(existing.contract) as unknown as Record<string, unknown>,
    );
  const contract = withComputedDates({
    ...changedContract,
    ...(isRecord(storedContract.familyAlert)
      ? { familyAlert: storedContract.familyAlert }
      : {}),
  });
  if (!enforceProvenanceConsistency(contract)) {
    res.status(400).json({ error: "Contract provenance is inconsistent with its field values." });
    return;
  }
  const parentContractId =
    parsed.data.parentContractId === undefined
      ? existing.parentContractId
      : parsed.data.parentContractId;
  const parentError = await validateParentContractId(parentContractId, id);
  if (parentError) {
    res.status(400).json({ error: parentError });
    return;
  }
  const [record] = await db
    .update(contractsTable)
    .set({
      filename: parsed.data.filename.slice(0, 250),
      parentContractId,
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
  const records = await db.select().from(contractsTable);
  res.json(responseFor(record, records));
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
  const parentError = await validateParentContractId(parsed.data.parentContractId);
  if (parentError) {
    res.status(400).json({ error: parentError });
    return;
  }
  const contract = withComputedDates(parsed.data.contract as unknown as Record<string, unknown>);
  const [record] = await db.insert(contractsTable).values({
    id: randomUUID(),
    filename: parsed.data.filename.slice(0, 250),
    parentContractId: parsed.data.parentContractId ?? null,
    documentType: contractDocumentType(contract),
    contract,
    confidence: {},
  }).returning();
  const records = await db.select().from(contractsTable);
  res.status(201).json(responseFor(record, records));
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