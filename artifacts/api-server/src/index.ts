import app from "./app";
import { logger } from "./lib/logger";
import { contractIngestItemsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  expireContractIngestUploadReservations,
  processContractIngestObjectCleanup,
} from "./lib/contract-ingest-cleanup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await db.update(contractIngestItemsTable)
  .set({
    state: "failed",
    message: "Processing was interrupted. Retry this PDF.",
    updatedAt: new Date(),
  })
  .where(eq(contractIngestItemsTable.state, "processing"));

await expireContractIngestUploadReservations();
await processContractIngestObjectCleanup();
const cleanupTimer = setInterval(() => {
  void processContractIngestObjectCleanup().catch((error) => {
    logger.warn({ err: error }, "Unable to process contract ingest object cleanup queue");
  });
}, 60_000);
cleanupTimer.unref();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
