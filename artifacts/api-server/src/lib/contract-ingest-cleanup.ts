import { asc, eq, inArray, sql } from "drizzle-orm";
import { contractIngestObjectCleanupTable, db } from "@workspace/db";
import {
  createContractIngestStoragePath,
  deleteContractIngestPdf,
  storeContractIngestPdf,
} from "./contract-ingest-storage";

export async function processContractIngestObjectCleanup(storagePaths?: string[]) {
  if (storagePaths?.length) {
    await db.update(contractIngestObjectCleanupTable)
      .set({
        state: "cleanup_pending",
        updatedAt: new Date(),
      })
      .where(inArray(contractIngestObjectCleanupTable.storagePath, storagePaths));
  }
  const paths = storagePaths ?? (await db.select({
    storagePath: contractIngestObjectCleanupTable.storagePath,
  })
    .from(contractIngestObjectCleanupTable)
    .where(eq(contractIngestObjectCleanupTable.state, "cleanup_pending"))
    .orderBy(asc(contractIngestObjectCleanupTable.createdAt))
    .limit(20))
    .map((item) => item.storagePath);

  for (const storagePath of paths) {
    try {
      await deleteContractIngestPdf(storagePath);
      await db.delete(contractIngestObjectCleanupTable)
        .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
    } catch (error) {
      await db.update(contractIngestObjectCleanupTable)
        .set({
          attempts: sql`${contractIngestObjectCleanupTable.attempts} + 1`,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown cleanup error",
          updatedAt: new Date(),
        })
        .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
    }
  }
}

export async function expireContractIngestUploadReservations() {
  await db.update(contractIngestObjectCleanupTable)
    .set({
      state: "cleanup_pending",
      updatedAt: new Date(),
    })
    .where(eq(contractIngestObjectCleanupTable.state, "uploading"));
}

export async function reserveAndStoreContractIngestPdf(pdf: Buffer): Promise<string> {
  const storagePath = createContractIngestStoragePath();
  await db.insert(contractIngestObjectCleanupTable)
    .values({
      storagePath,
      state: "uploading",
    })
    .onConflictDoNothing();
  try {
    await storeContractIngestPdf(pdf, storagePath);
    return storagePath;
  } catch (error) {
    await db.update(contractIngestObjectCleanupTable)
      .set({
        state: "cleanup_pending",
        updatedAt: new Date(),
      })
      .where(eq(contractIngestObjectCleanupTable.storagePath, storagePath));
    await processContractIngestObjectCleanup([storagePath]);
    throw error;
  }
}