import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const contractsTable = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    filename: text("filename").notNull(),
    fileHash: text("file_hash"),
    parentContractId: uuid("parent_contract_id"),
    documentType: text("document_type"),
    contract: jsonb("contract").notNull(),
    confidence: jsonb("confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contracts_file_hash_unique")
      .on(table.fileHash)
      .where(sql`${table.fileHash} IS NOT NULL`),
  ],
);

export const registryViewsTable = pgTable(
  "registry_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    search: text("search").notNull().default(""),
    documentType: text("document_type"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    pinnedOrder: integer("pinned_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("registry_views_pinned_order_unique")
      .on(table.pinnedOrder)
      .where(sql`${table.pinnedOrder} IS NOT NULL`),
  ],
);

export const contractIngestRunsTable = pgTable("contract_ingest_runs", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contractIngestItemsTable = pgTable("contract_ingest_items", {
  id: text("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => contractIngestRunsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  size: integer("size").notNull(),
  hash: text("hash").notNull(),
  storagePath: text("storage_path").notNull(),
  state: text("state").notNull().default("processing"),
  processingAttemptId: text("processing_attempt_id"),
  message: text("message"),
  extraction: jsonb("extraction"),
  handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contractIngestObjectCleanupTable = pgTable("contract_ingest_object_cleanup", {
  storagePath: text("storage_path").primaryKey(),
  state: text("state").notNull().default("uploading"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contractIngestCompletionsTable = pgTable("contract_ingest_completions", {
  itemId: text("item_id").primaryKey(),
  runId: uuid("run_id").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ContractRecord = typeof contractsTable.$inferSelect;
export type RegistryViewRecord = typeof registryViewsTable.$inferSelect;
export type ContractIngestRunRecord = typeof contractIngestRunsTable.$inferSelect;
export type ContractIngestItemRecord = typeof contractIngestItemsTable.$inferSelect;
export type ContractIngestObjectCleanupRecord = typeof contractIngestObjectCleanupTable.$inferSelect;
export type ContractIngestCompletionRecord = typeof contractIngestCompletionsTable.$inferSelect;