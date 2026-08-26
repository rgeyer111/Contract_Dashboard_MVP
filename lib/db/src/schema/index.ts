import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const contractsTable = pgTable("contracts", {
  id: uuid("id").defaultRandom().primaryKey(),
  filename: text("filename").notNull(),
  parentContractId: uuid("parent_contract_id"),
  documentType: text("document_type"),
  contract: jsonb("contract").notNull(),
  confidence: jsonb("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ContractRecord = typeof contractsTable.$inferSelect;