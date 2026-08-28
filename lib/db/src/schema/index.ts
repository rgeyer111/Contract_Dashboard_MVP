import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const LEGACY_ACCOUNT_ID = "legacy-development-owner";

export const contractsTable = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull().default(LEGACY_ACCOUNT_ID),
    filename: text("filename").notNull(),
    fileHash: text("file_hash"),
    sourceStoragePath: text("source_storage_path"),
    parentContractId: uuid("parent_contract_id"),
    documentType: text("document_type"),
    contract: jsonb("contract").notNull(),
    confidence: jsonb("confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contracts_account_file_hash_unique")
      .on(table.accountId, table.fileHash)
      .where(sql`${table.fileHash} IS NOT NULL`),
  ],
);

export const contractDecisionsTable = pgTable(
  "contract_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id").notNull().references(() => contractsTable.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    actor: text("actor").notNull(),
    snoozeUntil: date("snooze_until"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contract_decisions_contract_decided_idx").on(table.contractId, table.decidedAt),
    check("contract_decisions_decision_check", sql`${table.decision} IN ('renew', 'renegotiate', 'cancel', 'snooze')`),
    check("contract_decisions_actor_check", sql`length(btrim(${table.actor})) > 0`),
    check(
      "contract_decisions_snooze_date_check",
      sql`(${table.decision} = 'snooze' AND ${table.snoozeUntil} IS NOT NULL) OR (${table.decision} <> 'snooze' AND ${table.snoozeUntil} IS NULL)`,
    ),
  ],
);

export const registryViewsTable = pgTable(
  "registry_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull().default(LEGACY_ACCOUNT_ID),
    name: text("name").notNull(),
    search: text("search").notNull().default(""),
    documentType: text("document_type"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    pinnedOrder: integer("pinned_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("registry_views_account_pinned_order_unique")
      .on(table.accountId, table.pinnedOrder)
      .where(sql`${table.pinnedOrder} IS NOT NULL`),
  ],
);

export const contractIngestRunsTable = pgTable("contract_ingest_runs", {
  id: uuid("id").primaryKey(),
  accountId: text("account_id").notNull().default(LEGACY_ACCOUNT_ID),
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
  contractId: uuid("contract_id"),
  storagePath: text("storage_path"),
  completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contractWasteTable = pgTable("contract_waste", {
  id: uuid("id").primaryKey(),
  storagePath: text("storage_path").notNull().unique(),
  filename: text("filename").notNull(),
  vendorLegalName: text("vendor_legal_name"),
  contractTitle: text("contract_title"),
  contractNumber: text("contract_number"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
  purgedAt: timestamp("purged_at", { withTimezone: true }),
});

export const contractWasteAuditTable = pgTable(
  "contract_waste_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wasteId: uuid("waste_id").notNull(),
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    purgedAt: timestamp("purged_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contract_waste_audit_waste_action_unique").on(table.wasteId, table.action),
    check("contract_waste_audit_action_check", sql`${table.action} = 'purged'`),
  ],
);

export type ContractRecord = typeof contractsTable.$inferSelect;
export type ContractDecisionRecord = typeof contractDecisionsTable.$inferSelect;
export type RegistryViewRecord = typeof registryViewsTable.$inferSelect;
export type ContractIngestRunRecord = typeof contractIngestRunsTable.$inferSelect;
export type ContractIngestItemRecord = typeof contractIngestItemsTable.$inferSelect;
export type ContractIngestObjectCleanupRecord = typeof contractIngestObjectCleanupTable.$inferSelect;
export type ContractIngestCompletionRecord = typeof contractIngestCompletionsTable.$inferSelect;
export type ContractWasteRecord = typeof contractWasteTable.$inferSelect;
export type ContractWasteAuditRecord = typeof contractWasteAuditTable.$inferSelect;
