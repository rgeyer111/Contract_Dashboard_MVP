import app from "./app";
import { logger } from "./lib/logger";
import { recoverContractIngestState } from "./lib/contract-ingest-cleanup";

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

await recoverContractIngestState();
const cleanupTimer = setInterval(() => {
  void recoverContractIngestState().catch((error) => {
    logger.warn({ err: error }, "Unable to recover contract ingest state");
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
