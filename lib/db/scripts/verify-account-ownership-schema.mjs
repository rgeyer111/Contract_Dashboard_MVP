import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set before verifying account ownership schema.",
  );
}

const requiredColumns = [
  ["contract_ingest_runs", "account_id"],
  ["contracts", "account_id"],
  ["registry_views", "account_id"],
];

const requiredIndexes = new Map([
  [
    "contracts_account_file_hash_unique",
    /\(account_id,\s*file_hash\).*WHERE \(file_hash IS NOT NULL\)/i,
  ],
  [
    "registry_views_account_pinned_order_unique",
    /\(account_id,\s*pinned_order\).*WHERE \(pinned_order IS NOT NULL\)/i,
  ],
]);

const forbiddenIndexes = [
  "contracts_file_hash_unique",
  "registry_views_pinned_order_unique",
];

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();

  const columns = await client.query(`
    SELECT table_name, column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'account_id'
      AND table_name = ANY($1::text[])
  `, [requiredColumns.map(([tableName]) => tableName)]);

  for (const [tableName, columnName] of requiredColumns) {
    const column = columns.rows.find(
      (row) =>
        row.table_name === tableName && row.column_name === columnName,
    );
    if (!column) {
      throw new Error(`Missing ${tableName}.${columnName}`);
    }
    if (column.is_nullable !== "NO") {
      throw new Error(`${tableName}.${columnName} must be NOT NULL`);
    }
    if (!column.column_default?.includes("legacy-development-owner")) {
      throw new Error(
        `${tableName}.${columnName} must backfill legacy rows safely`,
      );
    }
  }

  const indexes = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ANY($1::text[])
  `, [requiredColumns.map(([tableName]) => tableName)]);
  const indexDefinitions = new Map(
    indexes.rows.map((row) => [row.indexname, row.indexdef]),
  );

  for (const [indexName, expectedDefinition] of requiredIndexes) {
    const definition = indexDefinitions.get(indexName);
    if (!definition || !expectedDefinition.test(definition)) {
      throw new Error(`Missing or invalid ${indexName}`);
    }
  }

  for (const indexName of forbiddenIndexes) {
    if (indexDefinitions.has(indexName)) {
      throw new Error(`Superseded global index still exists: ${indexName}`);
    }
  }

  console.log("Verified account ownership schema and scoped indexes.");
} finally {
  await client.end();
}