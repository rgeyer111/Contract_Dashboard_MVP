import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

export type ContractRecord = typeof contractsTable.$inferSelect;
export type RegistryViewRecord = typeof registryViewsTable.$inferSelect;