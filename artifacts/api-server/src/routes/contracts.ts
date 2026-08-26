import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { desc, eq } from "drizzle-orm";
import { db, contractsTable } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  CreateContractBody,
  UpdateContractBody,
} from "@workspace/api-zod";
import {
  extractContractFromText,
  extractReadablePdfText,
  extractScannedPdfText,
} from "../lib/contract-extraction";
import { computeContractDates } from "../lib/contract-computation";

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
      negotiationBufferDays: parseLegacyPeriod(legacy.negotiationBuffer)?.amount ?? 30,
      negotiationBufferSource: "global_default",
      status: ["At Risk", "Review Open", "In Negotiation"].includes(String(legacy.status))
        ? legacy.status
        : "Review Open",
    },
  });
}

function responseFor(record: typeof contractsTable.$inferSelect) {
  return {
    id: record.id,
    filename: record.filename,
    contract: upgradeContract(record.contract),
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
  const contract = withComputedDates(
    sanitizeChangedFields(
      parsed.data.contract as unknown as Record<string, unknown>,
      upgradeContract(existing.contract) as unknown as Record<string, unknown>,
    ),
  );
  if (!enforceProvenanceConsistency(contract)) {
    res.status(400).json({ error: "Contract provenance is inconsistent with its field values." });
    return;
  }
  const [record] = await db
    .update(contractsTable)
    .set({
      filename: parsed.data.filename.slice(0, 250),
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
  const contract = withComputedDates(parsed.data.contract as unknown as Record<string, unknown>);
  const [record] = await db.insert(contractsTable).values({
    id: randomUUID(),
    filename: parsed.data.filename.slice(0, 250),
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