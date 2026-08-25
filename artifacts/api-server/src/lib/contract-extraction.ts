import { openai } from "@workspace/integrations-openai-ai-server";
import { ExtractContractResponse } from "@workspace/api-zod";
import pdf from "pdf-parse";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const extractionConfidence = ["High", "Medium", "Low"] as const;
const contractTypes = [
  "Maintenance",
  "Software License",
  "Real Estate",
  "Infrastructure",
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

export function normalizeExtraction(raw: unknown) {
  const response = asRecord(raw);
  const contract = asRecord(response.contract);
  const confidence = asRecord(response.confidence);

  const requestedType = safeText(contract.contractType);
  const contractType = contractTypes.includes(requestedType as (typeof contractTypes)[number])
    ? requestedType
    : "";

  const rawAmount = contract.contractValue;
  const valueCandidate =
    rawAmount && typeof rawAmount === "object"
      ? (rawAmount as Record<string, unknown>)
      : {};
  const amount =
    typeof valueCandidate.amount === "number" && Number.isFinite(valueCandidate.amount)
      ? valueCandidate.amount
      : null;
  const currency = safeText(valueCandidate.currency).toUpperCase();
  const valueIsStated =
    valueCandidate.status === "stated" && amount !== null && amount > 0 && /^[A-Z]{3}$/.test(currency);

  return {
    contract: {
      vendor: safeText(contract.vendor),
      contractNumber: safeText(contract.contractNumber),
      contractName: safeText(contract.contractName),
      contractType,
      contractValue: valueIsStated
        ? { status: "stated" as const, amount, currency }
        : { status: "unknown" as const, amount: null, currency: null },
      startDate: safeText(contract.startDate),
      contractDuration: safeText(contract.contractDuration),
      endDate: safeText(contract.endDate),
      noticePeriod: safeText(contract.noticePeriod),
      noticeDeadline: safeText(contract.noticeDeadline),
      negotiationBuffer: safeText(contract.negotiationBuffer),
      // In this unauthenticated MVP, every new record is assigned to the demo uploader.
      owner: "John Doe",
      status: "Review Open" as const,
    },
    confidence: {
      vendor: safeConfidence(confidence.vendor),
      contractNumber: safeConfidence(confidence.contractNumber),
      contractName: safeConfidence(confidence.contractName),
      contractType: safeConfidence(confidence.contractType),
      contractValue: safeConfidence(confidence.contractValue),
      startDate: safeConfidence(confidence.startDate),
      contractDuration: safeConfidence(confidence.contractDuration),
      endDate: safeConfidence(confidence.endDate),
      noticePeriod: safeConfidence(confidence.noticePeriod),
      noticeDeadline: safeConfidence(confidence.noticeDeadline),
      negotiationBuffer: safeConfidence(confidence.negotiationBuffer),
      owner: "High" as const,
      status: "High" as const,
    },
  };
}

export async function extractReadablePdfText(buffer: Buffer): Promise<string> {
  const result = await pdf(buffer);
  return result.text.replace(/\s+/g, " ").trim();
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
        content: `You extract contract metadata for a review screen. Use only the supplied contract text; do not invent facts. Return a single JSON object with this exact shape: {"contract": {...}, "confidence": {...}}.

contract must contain vendor, contractNumber, contractName, contractType, contractValue, startDate, contractDuration, endDate, noticePeriod, noticeDeadline, negotiationBuffer. Use empty strings for unknown string fields. contractType must be one of Maintenance, Software License, Real Estate, Infrastructure, or an empty string when no category is supported by evidence. contractValue must be {"status":"stated","amount":number,"currency":"ISO-4217"} only when an explicit numeric value and currency are clear; otherwise use {"status":"unknown"}. Format dates as YYYY-MM-DD when a full date is available. Express durations and notice periods plainly, for example "60 days" or "24 months".

confidence must contain every matching field and use High, Medium, or Low. High means directly stated, Medium means clear but inferred from surrounding text, and Low means absent, unclear, or ambiguous. Do not include owner or status; the application assigns those itself.`,
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