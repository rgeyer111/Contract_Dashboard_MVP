import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  contractIngestItemsTable,
  contractIngestObjectCleanupTable,
  db,
} from "@workspace/db";
import {
  createContractIngestStoragePath,
  deleteContractIngestPdf,
  storeContractIngestPdf,
} from "./contract-ingest-storage";

const interruptedUploadRecoveryAgeMs = 15 * 60_000;

function hasNoIngestOwner() {
  return sql`NOT EXISTS (
    SELECT 1
    FROM ${contractIngestItemsTable}
    WHERE ${contractIngestItemsTable.storagePath} = ${contractIngestObjectCleanupTable.storagePath}
  )`;
}

export async function queueContractIngestObjectCleanup(storagePaths: string[]) {
  if (!storagePaths.length) return;
  await db.update(contractIngestObjectCleanupTable)
    .set({
      state: "cleanup_pending",
      updatedAt: new Date(),
    })
    .where(inArray(contractIngestObjectCleanupTable.storagePath, storagePaths));
}

export async function processContractIngestObjectCleanup(storagePaths?: string[]) {
  const paths = (await db.select({
    storagePath: contractIngestObjectCleanupTable.storagePath,
  })
    .from(contractIngestObjectCleanupTable)
    .where(storagePaths?.length
      ? and(
        eq(contractIngestObjectCleanupTable.state, "cleanup_pending"),
        inArray(contractIngestObjectCleanupTable.storagePath, storagePaths),
        hasNoIngestOwner(),
      )
      : and(
        eq(contractIngestObjectCleanupTable.state, "cleanup_pending"),
        hasNoIngestOwner(),
      ))
    .orderBy(asc(contractIngestObjectCleanupTable.createdAt))
    .limit(20))
    .map((item) => item.storagePath);

  for (const storagePath of paths) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${storagePath}))`);
        const [eligible] = await tx.select({
          storagePath: contractIngestObjectCleanupTable.storagePath,
        })
          .from(contractIngestObjectCleanupTable)
          .where(and(
            eq(contractIngestObjectCleanupTable.storagePath, storagePath),
            eq(contractIngestObjectCleanupTable.state, "cleanup_pending"),
            hasNoIngestOwner(),
          ));
        if (!eligible) return;

        await deleteContractIngestPdf(storagePath);
        await tx.delete(contractIngestObjectCleanupTable)
          .where(and(
            eq(contractIngestObjectCleanupTable.storagePath, storagePath),
            eq(contractIngestObjectCleanupTable.state, "cleanup_pending"),
          ));
      });
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

export async function expireContractIngestUploadReservations(options: {
  olderThan?: Date;
  storagePaths?: string[];
} = {}) {
  const olderThan = options.olderThan ?? new Date(Date.now() - interruptedUploadRecoveryAgeMs);
  await db.update(contractIngestObjectCleanupTable)
    .set({
      state: "cleanup_pending",
      updatedAt: new Date(),
    })
    .where(and(
      eq(contractIngestObjectCleanupTable.state, "uploading"),
      lt(contractIngestObjectCleanupTable.createdAt, olderThan),
      hasNoIngestOwner(),
      ...(options.storagePaths?.length
        ? [inArray(contractIngestObjectCleanupTable.storagePath, options.storagePaths)]
        : []),
    ));
}

export async function recoverContractIngestState(options: {
  itemIds?: string[];
  storagePaths?: string[];
  olderThan?: Date;
} = {}) {
  const olderThan = options.olderThan ?? new Date(Date.now() - interruptedUploadRecoveryAgeMs);
  await db.update(contractIngestItemsTable)
    .set({
      state: "failed",
      processingAttemptId: null,
      message: "Processing was interrupted. Retry this PDF.",
      updatedAt: new Date(),
    })
    .where(and(
      eq(contractIngestItemsTable.state, "processing"),
      lt(contractIngestItemsTable.updatedAt, olderThan),
      ...(options.itemIds?.length
        ? [inArray(contractIngestItemsTable.id, options.itemIds)]
        : []),
    ));

  await expireContractIngestUploadReservations({
    olderThan,
    storagePaths: options.storagePaths,
  });
  await processContractIngestObjectCleanup(options.storagePaths);
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
    await queueContractIngestObjectCleanup([storagePath]);
    await processContractIngestObjectCleanup([storagePath]);
    throw error;
  }
}