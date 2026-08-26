import { openai } from "@workspace/integrations-openai-ai-server";
import { ExtractContractResponse } from "@workspace/api-zod";
import pdf from "pdf-parse";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  CONTRACT_EXTRACTION_PROMPT_VERSION,
  CONTRACT_EXTRACTION_SYSTEM_PROMPT,
} from "./contract-extraction-prompt";
import { computeContractDates } from "./contract-computation";

const extractionConfidence = ["High", "Medium", "Low"] as const;
const provenanceStatuses = ["found", "not_found", "ambiguous", "conflicting"] as const;
const provenanceConfidences = ["high", "medium", "low"] as const;
const periodUnits = ["days", "weeks", "months", "years"] as const;
const noticeAnchors = [
  "term_end",
  "renewal_date",
  "anniversary",
  "period_end_month",
  "period_end_quarter",
  "period_end_year",
  "any_time",
  "unknown",
] as const;

type ExtractionConfidence = (typeof extractionConfidence)[number];
export type ExtractionSource = "text" | "ocr";

const execFileAsync = promisify(execFile);
const ocrBatchSize = 1;
const maximumExtractionTextCharacters = 250_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 250) : "";
}

function safeConfidence(value: unknown): ExtractionConfidence {
  return extractionConfidence.includes(value as ExtractionConfidence)
    ? (value as ExtractionConfidence)
    : "Low";
}

export class ContractTextTooLongError extends Error {
  readonly code = "CONTRACT_TEXT_TOO_LONG";

  constructor(characterCount: number) {
    super(
      `This contract contains too much extracted text to process in one review (${characterCount.toLocaleString()} characters; the limit is ${maximumExtractionTextCharacters.toLocaleString()}). Split the PDF into smaller files and upload each part. No pages were omitted.`,
    );
    this.name = "ContractTextTooLongError";
  }
}

export class OcrIncompleteError extends Error {
  readonly code = "OCR_INCOMPLETE";

  constructor(pageNumber: number, pageCount: number) {
    super(
      `We could not fully transcribe scanned page ${pageNumber} of ${pageCount}. Split the PDF around that page and upload the parts separately. No partial review draft was created.`,
    );
    this.name = "OcrIncompleteError";
  }
}

function notFound(note: string | null = null) {
  return {
    value: null,
    status: "not_found" as const,
    confidence: "low" as const,
    page: null,
    clause: null,
    quote: null,
    note,
  };
}

function normalizeMetadata(raw: unknown) {
  const field = asRecord(raw);
  const status = provenanceStatuses.includes(field.status as never)
    ? (field.status as (typeof provenanceStatuses)[number])
    : "not_found";
  const confidence = provenanceConfidences.includes(field.confidence as never)
    ? (field.confidence as (typeof provenanceConfidences)[number])
    : "low";
  const page =
    typeof field.page === "number" && Number.isInteger(field.page) && field.page > 0
      ? field.page
      : null;
  const clause = safeText(field.clause) || null;
  const quote = typeof field.quote === "string" ? field.quote.trim().slice(0, 300) || null : null;
  const note = typeof field.note === "string" ? field.note.trim().slice(0, 500) || null : null;

  if (status === "not_found") return notFound();
  if (!quote || !page) return notFound("The model did not provide complete page and quote evidence.");
  return { status, confidence, page, clause, quote, note };
}

function normalizeField<T>(raw: unknown, parseValue: (value: unknown) => T | null) {
  const field = asRecord(raw);
  const metadata = normalizeMetadata(raw);
  if (metadata.status === "not_found") return metadata;
  const value = parseValue(field.value);
  return value === null
    ? notFound("The extracted value did not match the required field type.")
    : { value, ...metadata };
}

const enumValue =
  <T extends readonly string[]>(allowed: T) =>
  (value: unknown): T[number] | null =>
    allowed.includes(value as T[number]) ? (value as T[number]) : null;

const stringValue = (value: unknown) => safeText(value) || null;
const dateValue = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

function periodValue(value: unknown) {
  const candidate = asRecord(value);
  return typeof candidate.amount === "number" &&
    Number.isInteger(candidate.amount) &&
    candidate.amount > 0 &&
    periodUnits.includes(candidate.unit as never)
    ? { amount: candidate.amount, unit: candidate.unit as (typeof periodUnits)[number] }
    : null;
}

function noticePeriodValue(value: unknown) {
  const parseOne = (item: unknown) => {
    const candidate = asRecord(item);
    const purpose = ["non_renewal", "termination_for_convenience", "other"].includes(
      candidate.purpose as string,
    )
      ? (candidate.purpose as "non_renewal" | "termination_for_convenience" | "other")
      : null;
    return typeof candidate.amount === "number" &&
      Number.isInteger(candidate.amount) &&
      candidate.amount > 0 &&
      periodUnits.includes(candidate.unit as never) &&
      noticeAnchors.includes(candidate.anchor as never)
      ? {
          amount: candidate.amount,
          unit: candidate.unit as (typeof periodUnits)[number],
          anchor: candidate.anchor as (typeof noticeAnchors)[number],
          purpose,
        }
      : null;
  };
  if (Array.isArray(value)) {
    const values = value.map(parseOne);
    return values.length > 0 && values.every(Boolean) ? values : null;
  }
  return parseOne(value);
}

function noticeDeliveryValue(value: unknown) {
  const candidate = asRecord(value);
  const methods = ["email", "registered_post", "post", "portal", "any_written"] as const;
  if (!methods.includes(candidate.method as never)) return null;
  return {
    method: candidate.method as (typeof methods)[number],
    address: safeText(candidate.address) || null,
    cc: Array.isArray(candidate.cc)
      ? candidate.cc.map(safeText).filter(Boolean).slice(0, 20)
      : [],
  };
}

function contractValue(value: unknown) {
  const candidate = asRecord(value);
  const bases = [
    "total_contract_value",
    "annual",
    "monthly",
    "per_unit",
    "not_to_exceed",
    "variable",
  ] as const;
  const currency = safeText(candidate.currency).toUpperCase();
  return typeof candidate.amount === "number" &&
    Number.isFinite(candidate.amount) &&
    candidate.amount >= 0 &&
    /^[A-Z]{3}$/.test(currency) &&
    bases.includes(candidate.basis as never)
    ? { amount: candidate.amount, currency, basis: candidate.basis as (typeof bases)[number] }
    : null;
}

export function normalizeExtraction(raw: unknown) {
  const fields = asRecord(asRecord(raw).fields);
  const contract = {
      fields: {
        documentType: normalizeField(
          fields.documentType,
          enumValue([
            "master_agreement",
            "order_form",
            "sow",
            "amendment",
            "renewal_letter",
            "termination_notice",
            "quote_or_proposal",
            "unknown",
          ] as const),
        ),
        documentLanguage: normalizeField(
          fields.documentLanguage,
          enumValue(["de", "en", "fr", "it", "other"] as const),
        ),
        vendorLegalName: normalizeField(fields.vendorLegalName, stringValue),
        buyerLegalEntity: normalizeField(fields.buyerLegalEntity, stringValue),
        contractTitle: normalizeField(fields.contractTitle, stringValue),
        contractNumber: normalizeField(fields.contractNumber, stringValue),
        contractType: normalizeField(
          fields.contractType,
          enumValue([
            "maintenance",
            "software_license",
            "saas_subscription",
            "real_estate",
            "infrastructure",
            "professional_services",
            "data_services",
            "equipment_lease",
            "other",
          ] as const),
        ),
        signatureDate: normalizeField(fields.signatureDate, dateValue),
        effectiveDate: normalizeField(fields.effectiveDate, dateValue),
        initialTermLength: normalizeField(fields.initialTermLength, periodValue),
        initialTermEndDate: normalizeField(fields.initialTermEndDate, dateValue),
        renewalMechanism: normalizeField(
          fields.renewalMechanism,
          enumValue(["auto_renew", "expires", "by_mutual_agreement", "indefinite", "unknown"] as const),
        ),
        renewalTermLength: normalizeField(fields.renewalTermLength, periodValue),
        noticePeriod: normalizeField(fields.noticePeriod, noticePeriodValue),
        noticeDeadline: notFound("Computed by the application; never extracted from model output."),
        noticeDelivery: normalizeField(fields.noticeDelivery, noticeDeliveryValue),
        contractValue: normalizeField(fields.contractValue, contractValue),
        billingFrequency: normalizeField(
          fields.billingFrequency,
          enumValue(["annual", "quarterly", "monthly", "one_time", "milestone", "usage"] as const),
        ),
      },
      assignment: {
        owner: "John Doe",
        negotiationBufferDays: 30,
        negotiationBufferSource: "global_default" as const,
        status: "Review Open" as const,
      },
    };
  return {
    contract: {
      ...contract,
      computed: computeContractDates(contract),
    },
  };
}

export async function extractReadablePdfText(buffer: Buffer): Promise<string> {
  const result = await pdf(buffer, {
    pagerender: async (page: {
      pageNumber: number;
      getTextContent: (options: Record<string, boolean>) => Promise<{ items: Array<{ str?: string }> }>;
    }) => {
      const content = await page.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      return `--- Page ${page.pageNumber} ---\n${content.items
        .map((item) => item.str ?? "")
        .join(" ")}`;
    },
  });
  return result.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractContractFromText(
  text: string,
  filename: string,
  metadata: {
    source?: ExtractionSource;
    ocrConfidence?: ExtractionConfidence;
    ocrPageCount?: number;
    ocrPagesProcessed?: number;
  } = {},
) {
  if (text.length > maximumExtractionTextCharacters) {
    throw new ContractTextTooLongError(text.length);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${CONTRACT_EXTRACTION_SYSTEM_PROMPT}\n\nPrompt version: ${CONTRACT_EXTRACTION_PROMPT_VERSION}`,
      },
      {
        role: "user",
        content: `Filename: ${filename}\n\nContract text:\n${text}`,
      },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error("The extraction service returned no usable result.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("The extraction service returned an invalid result.");
  }

  return ExtractContractResponse.parse({
    filename,
    extraction: {
      ...normalizeExtraction(raw),
      source: metadata.source ?? "text",
      ocrConfidence: metadata.ocrConfidence ?? null,
      ocrPageCount: metadata.source === "ocr" ? metadata.ocrPageCount ?? null : null,
      ocrPagesProcessed:
        metadata.source === "ocr" ? metadata.ocrPagesProcessed ?? null : null,
    },
  });
}

function imageContent(data: Buffer) {
  return {
    type: "image_url" as const,
    image_url: { url: `data:image/png;base64,${data.toString("base64")}` },
  };
}

function parseOcrResponse(content: string): { text: string; confidence: ExtractionConfidence } {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("The OCR service returned an invalid result.");
  }

  const response = asRecord(raw);
  const text = typeof response.text === "string" ? response.text.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    throw new Error("The OCR service returned no usable contract text.");
  }
  return { text, confidence: safeConfidence(response.confidence) };
}

export async function extractScannedPdfText(buffer: Buffer): Promise<{
  text: string;
  confidence: ExtractionConfidence;
  pageCount: number;
  pagesProcessed: number;
}> {
  const directory = await mkdtemp(join(tmpdir(), "contract-ocr-"));
  const inputPath = join(directory, "contract.pdf");
  const outputPrefix = join(directory, "page");

  try {
    await writeFile(inputPath, buffer);
    const { stdout: pdfInfo } = await execFileAsync("pdfinfo", [inputPath]);
    const pagesLine = pdfInfo
      .split(/\r?\n/)
      .find((line) => /^\s*Pages:\s*\d+\s*$/.test(line));
    const pageCount = pagesLine ? Number(pagesLine.match(/\d+/)?.[0]) : NaN;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw new Error("Unable to determine the complete page count for this PDF.");
    }

    const transcriptions: string[] = [];
    const confidences: ExtractionConfidence[] = [];

    for (let startPage = 1; startPage <= pageCount; startPage += ocrBatchSize) {
      const endPage = Math.min(startPage + ocrBatchSize - 1, pageCount);
      await execFileAsync("pdftoppm", [
        "-png",
        "-r",
        "150",
        "-f",
        String(startPage),
        "-l",
        String(endPage),
        inputPath,
        outputPrefix,
      ]);

      const { stdout } = await execFileAsync("find", [
        directory,
        "-maxdepth",
        "1",
        "-type",
        "f",
        "-name",
        "page-*.png",
        "-print",
      ]);
      const pagePaths = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .filter((pagePath) => {
          const match = /page-(\d+)\.png$/.exec(pagePath);
          if (!match) return false;
          const pageNumber = Number(match[1]);
          return pageNumber >= startPage && pageNumber <= endPage;
        })
        .sort((left, right) => {
          const leftNumber = Number(/page-(\d+)\.png$/.exec(left)?.[1]);
          const rightNumber = Number(/page-(\d+)\.png$/.exec(right)?.[1]);
          return leftNumber - rightNumber;
        });
      const expectedPageCount = endPage - startPage + 1;
      if (pagePaths.length !== expectedPageCount) {
        throw new Error(
          `The PDF renderer did not produce every page in batch ${startPage}-${endPage}.`,
        );
      }

      const pages = await Promise.all(pagePaths.map((pagePath) => readFile(pagePath)));
      const content = [
        {
          type: "text" as const,
          text: `OCR every supplied contract page in order. These are pages ${startPage}-${endPage} of ${pageCount}. Return JSON with exactly two keys: text (the complete transcription of every supplied page, preserving wording and numbers) and confidence (High, Medium, or Low). Confidence describes OCR legibility only: High means clear text, Medium means some uncertain characters, and Low means substantial uncertainty. Do not summarize or extract contract fields.`,
        },
        ...pages.map(imageContent),
      ];
      const response = await openai.chat.completions.create({
        model: "gpt-5.6-terra",
        max_completion_tokens: 16_384,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      });
      const choice = response.choices[0];
      const responseContent = choice?.message.content;
      if (!responseContent) {
        throw new Error("The OCR service returned no usable result.");
      }
      if (choice.finish_reason !== "stop") {
        throw new OcrIncompleteError(startPage, pageCount);
      }

      const transcription = parseOcrResponse(responseContent);
      transcriptions.push(`Page ${startPage}-${endPage}\n${transcription.text}`);
      confidences.push(transcription.confidence);
    }

    const confidence = confidences.reduce<ExtractionConfidence>(
      (lowest, current) => {
        const rank = { High: 0, Medium: 1, Low: 2 } as const;
        return rank[current] > rank[lowest] ? current : lowest;
      },
      "High",
    );
    const text = transcriptions.join("\n\n").replace(/\s+/g, " ").trim();
    if (text.length < 50) {
      throw new Error("The OCR service returned no usable contract text.");
    }
    return { text, confidence, pageCount, pagesProcessed: pageCount };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}