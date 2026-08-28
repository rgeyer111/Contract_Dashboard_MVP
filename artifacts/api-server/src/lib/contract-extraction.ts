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
import { computeContractAlert, computeContractDates } from "./contract-computation";

const extractionConfidence = ["High", "Medium", "Low"] as const;
const provenanceStatuses = ["found", "not_found", "ambiguous", "conflicting"] as const;
const provenanceConfidences = ["high", "medium", "low"] as const;
const periodUnits = ["days", "weeks", "months", "years"] as const;
const noticePeriodUnits = [...periodUnits, "business_days"] as const;
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
    alternatives: [],
  };
}

function normalizeAlternatives(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).flatMap((candidate) => {
    const alternative = asRecord(candidate);
    const page =
      typeof alternative.page === "number" &&
      Number.isInteger(alternative.page) &&
      alternative.page > 0
        ? alternative.page
        : null;
    const quote =
      typeof alternative.quote === "string"
        ? alternative.quote.trim().slice(0, 300) || null
        : null;
    if (
      !Object.prototype.hasOwnProperty.call(alternative, "value") ||
      alternative.value === null ||
      !page ||
      !quote
    ) {
      return [];
    }
    return [{
      value: alternative.value,
      page,
      clause: safeText(alternative.clause) || null,
      quote,
    }];
  });
}

function normalizeMetadata(
  raw: unknown,
  options: { allowLiteralUnsupportedUnitAmbiguity?: boolean } = {},
) {
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
  const alternatives = normalizeAlternatives(field.alternatives);

  if (status === "not_found") return notFound();
  if (!quote || !page) return notFound("The model did not provide complete page and quote evidence.");
  const permitsLiteralUnsupportedUnitAmbiguity =
    status === "ambiguous" && options.allowLiteralUnsupportedUnitAmbiguity;
  if (
    (status === "conflicting" || (status === "ambiguous" && !permitsLiteralUnsupportedUnitAmbiguity)) &&
    alternatives.length < 2
  ) {
    return notFound("The model did not provide two evidence-backed competing readings.");
  }
  return { status, confidence, page, clause, quote, note, alternatives };
}

function normalizeField<T>(
  raw: unknown,
  parseValue: (value: unknown) => T | null,
  options: { allowLiteralUnsupportedUnitAmbiguity?: boolean } = {},
) {
  const field = asRecord(raw);
  const metadata = normalizeMetadata(raw, options);
  if (metadata.status === "not_found") return metadata;
  const value = parseValue(field.value);
  if (value === null) return notFound("The extracted value did not match the required field type.");
  const alternatives = metadata.alternatives.map((alternative) => {
    const parsedValue = parseValue(alternative.value);
    return parsedValue === null ? null : { ...alternative, value: parsedValue };
  });
  if (alternatives.some((alternative) => alternative === null)) {
    return notFound("A competing reading did not match the required field type.");
  }
  return { value, ...metadata, alternatives: alternatives as Array<NonNullable<(typeof alternatives)[number]>> };
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
      noticePeriodUnits.includes(candidate.unit as never) &&
      noticeAnchors.includes(candidate.anchor as never)
      ? {
          amount: candidate.amount,
          unit: candidate.unit as (typeof noticePeriodUnits)[number],
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

function containsBusinessDays(value: unknown) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.some((item) => asRecord(item).unit === "business_days");
}

function normalizeNoticePeriodField(raw: unknown) {
  const field = asRecord(raw);
  const rawAlternatives = normalizeAlternatives(field.alternatives);
  const evidenceFallback = rawAlternatives[0];
  const metadata = normalizeMetadata({
    ...field,
    page: field.page ?? evidenceFallback?.page,
    clause: field.clause ?? evidenceFallback?.clause,
    quote: field.quote ?? evidenceFallback?.quote,
  }, {
    allowLiteralUnsupportedUnitAmbiguity: true,
  });
  if (metadata.status === "not_found") return metadata;

  const alternatives = metadata.alternatives.map((alternative) => {
    const parsedValue = noticePeriodValue(alternative.value);
    return parsedValue === null ? null : { ...alternative, value: parsedValue };
  });
  if (alternatives.some((alternative) => alternative === null)) {
    return notFound("A competing reading did not match the required notice-period type.");
  }

  let value = noticePeriodValue(field.value);
  if (
    value === null &&
    (metadata.status === "ambiguous" || metadata.status === "conflicting") &&
    alternatives.length >= 2
  ) {
    value = alternatives.flatMap((alternative) => {
      const candidate = alternative!.value;
      return Array.isArray(candidate) ? candidate : [candidate];
    });
  }
  if (value === null) {
    return notFound("The extracted value did not match the required field type.");
  }

  const normalized = {
    value,
    ...metadata,
    alternatives: alternatives as Array<NonNullable<(typeof alternatives)[number]>>,
  };

  const hasBusinessDays =
    containsBusinessDays(normalized.value) ||
    normalized.alternatives.some((alternative) => containsBusinessDays(alternative.value));

  if (normalized.status === "ambiguous" && normalized.alternatives.length < 2 && !hasBusinessDays) {
    return notFound("The model did not provide two evidence-backed competing readings.");
  }

  if (hasBusinessDays && normalized.status !== "conflicting") {
    return {
      ...normalized,
      status: "ambiguous" as const,
      confidence: normalized.confidence === "high" ? "medium" as const : normalized.confidence,
      note:
        normalized.note ??
        "The notice period uses business days and cannot be safely converted to calendar days.",
    };
  }

  return normalized;
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
        noticePeriod: normalizeNoticePeriodField(fields.noticePeriod),
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
        ownerEmail: "john.doe@example.com",
        negotiationBufferDays: 30,
        negotiationBufferSource: "global_default" as const,
        status: "Review Open" as const,
      },
    };
  const computed = computeContractDates(contract);
  return {
    contract: {
      ...contract,
      computed,
      alert: computeContractAlert(computed, contract.assignment),
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

  const rawFields = asRecord(asRecord(raw).fields);
  const noticeAudit = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a safety auditor checking one extracted contract field: noticePeriod.

Return one JSON object as {"noticePeriod": FIELD}, where FIELD follows this exact structure:
{"value":null,"status":"found|not_found|ambiguous|conflicting","confidence":"high|medium|low","page":null,"clause":null,"quote":null,"note":null,"alternatives":[]}

Review the complete document for every clause governing non-renewal or termination notice timing.
- Do not accept not_found merely because one clause is unclear. Use ambiguous when relevant timing wording exists but cannot be safely calculated.
- If body text, annexes, schedules, order forms, or amendments give different periods for the same notice right, use conflicting.
- A conflicting result must include every candidate in alternatives (at least two), each with typed value, page, clause, and verbatim quote.
- An ambiguous result must include every evidence-backed reading in alternatives (at least one), each with typed value, page, clause, and verbatim quote.
- Preserve business days or Werktage as unit business_days and mark the result ambiguous. Never convert them to calendar days.
- Typed values are {"amount":positive integer,"unit":"days|business_days|weeks|months|years","anchor":"term_end|renewal_date|anniversary|period_end_month|period_end_quarter|period_end_year|any_time|unknown","purpose":"non_renewal|termination_for_convenience|other"}.
- For a conflict, value may be the array of all candidate typed values. For ambiguity with one stated business-day period, value may be that typed value or a one-item array.
- Page markers in the supplied text are authoritative. Evidence quotes must be verbatim and no more than 300 characters.`,
      },
      {
        role: "user",
        content: `Filename: ${filename}\n\nContract text:\n${text}`,
      },
    ],
  });
  const auditContent = noticeAudit.choices[0]?.message.content;
  if (!auditContent) {
    throw new Error("The notice-period safety audit returned no usable result.");
  }
  try {
    const auditedNotice = asRecord(JSON.parse(auditContent)).noticePeriod;
    raw = { ...asRecord(raw), fields: { ...rawFields, noticePeriod: auditedNotice } };
  } catch {
    throw new Error("The notice-period safety audit returned an invalid result.");
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