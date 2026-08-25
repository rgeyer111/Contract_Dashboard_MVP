import { openai } from "@workspace/integrations-openai-ai-server";
import { ExtractContractResponse } from "@workspace/api-zod";
import pdf from "pdf-parse";

const extractionConfidence = ["High", "Medium", "Low"] as const;
const contractTypes = [
  "Maintenance",
  "Software License",
  "Real Estate",
  "Infrastructure",
] as const;

type ExtractionConfidence = (typeof extractionConfidence)[number];

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

function normalizeExtraction(raw: unknown) {
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

export async function extractContractFromText(text: string, filename: string) {
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
        content: `Filename: ${filename}\n\nContract text:\n${text.slice(0, 60_000)}`,
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
    extraction: normalizeExtraction(raw),
  });
}