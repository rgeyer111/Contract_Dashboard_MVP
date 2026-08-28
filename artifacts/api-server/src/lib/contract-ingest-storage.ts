import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const privateObjectPrefix = "/objects/uploads/contract-ingest/";
const wasteObjectPrefix = "/objects/uploads/contract-waste/";

function privateObjectDir() {
  const dir = process.env.PRIVATE_OBJECT_DIR?.trim().replace(/\/+$/, "");
  if (!dir) {
    throw new Error("PRIVATE_OBJECT_DIR is not configured for contract ingest storage.");
  }
  return dir;
}

function objectLocation(objectPath: string) {
  if (!objectPath.startsWith(privateObjectPrefix) && !objectPath.startsWith(wasteObjectPrefix)) {
    throw new Error("Invalid contract ingest storage path.");
  }

  const objectName = objectPath.slice("/objects/".length);
  const fullPath = `${privateObjectDir()}/${objectName}`;
  const pathParts = fullPath.replace(/^\/+/, "").split("/");
  const bucketName = pathParts.shift();
  if (!bucketName || !pathParts.length || pathParts.some((part) => !part)) {
    throw new Error("Invalid private object storage configuration.");
  }

  return { bucketName, objectName: pathParts.join("/") };
}

export function createContractWasteStoragePath(contractId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) {
    throw new Error("Invalid contract identifier for waste storage.");
  }
  return `${wasteObjectPrefix}${contractId}.pdf`;
}

async function signedObjectUrl(
  objectPath: string,
  method: "GET" | "PUT" | "DELETE",
) {
  const { bucketName, objectName } = objectLocation(objectPath);
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to access contract ingest storage (${response.status}).`);
  }

  const body = await response.json() as { signed_url?: unknown };
  if (typeof body.signed_url !== "string" || !body.signed_url) {
    throw new Error("Contract ingest storage returned an invalid signed URL.");
  }
  return body.signed_url;
}

export function createContractIngestStoragePath(): string {
  return `${privateObjectPrefix}${randomUUID()}`;
}

export async function storeContractIngestPdf(
  pdf: Buffer,
  objectPath = createContractIngestStoragePath(),
): Promise<string> {
  const uploadUrl = await signedObjectUrl(objectPath, "PUT");
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
    },
    body: pdf,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to store contract PDF (${response.status}).`);
  }
  return objectPath;
}

export async function readContractIngestPdf(objectPath: string): Promise<Buffer> {
  const downloadUrl = await signedObjectUrl(objectPath, "GET");
  const response = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "The stored contract PDF is no longer available. Upload this batch again."
        : `Unable to read the stored contract PDF (${response.status}).`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function copyContractPdfToWaste(
  sourcePath: string,
  contractId: string,
): Promise<string> {
  const pdf = await readContractIngestPdf(sourcePath);
  const wastePath = createContractWasteStoragePath(contractId);
  await storeContractIngestPdf(pdf, wastePath);
  const stored = await readContractIngestPdf(wastePath);
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  if (digest(pdf) !== digest(stored)) {
    throw new Error("The contract PDF could not be verified in waste storage.");
  }
  return wastePath;
}

export async function deleteContractIngestPdf(objectPath: string): Promise<void> {
  const deleteUrl = await signedObjectUrl(objectPath, "DELETE");
  const response = await fetch(deleteUrl, {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Unable to delete stored contract PDF (${response.status}).`);
  }
}

export async function readContractWastePdf(objectPath: string): Promise<Buffer> {
  if (!objectPath.startsWith(wasteObjectPrefix)) {
    throw new Error("Invalid contract waste storage path.");
  }
  return readContractIngestPdf(objectPath);
}

export async function deleteContractWastePdf(objectPath: string): Promise<void> {
  if (!objectPath.startsWith(wasteObjectPrefix)) {
    throw new Error("Invalid contract waste storage path.");
  }
  return deleteContractIngestPdf(objectPath);
}

export async function deleteContractIngestPdfs(objectPaths: string[]): Promise<void> {
  await Promise.all(objectPaths.map((objectPath) => deleteContractIngestPdf(objectPath)));
}