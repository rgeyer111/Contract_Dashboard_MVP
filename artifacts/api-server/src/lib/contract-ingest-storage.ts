import { randomUUID } from "node:crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const privateObjectPrefix = "/objects/uploads/contract-ingest/";

function privateObjectDir() {
  const dir = process.env.PRIVATE_OBJECT_DIR?.trim().replace(/\/+$/, "");
  if (!dir) {
    throw new Error("PRIVATE_OBJECT_DIR is not configured for contract ingest storage.");
  }
  return dir;
}

function objectLocation(objectPath: string) {
  if (!objectPath.startsWith(privateObjectPrefix)) {
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

export async function deleteContractIngestPdfs(objectPaths: string[]): Promise<void> {
  await Promise.all(objectPaths.map((objectPath) => deleteContractIngestPdf(objectPath)));
}