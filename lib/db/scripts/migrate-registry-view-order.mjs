import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before migrating registry view order.");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("LOCK TABLE registry_views IN SHARE ROW EXCLUSIVE MODE");
  await client.query("ALTER TABLE registry_views ADD COLUMN IF NOT EXISTS pinned_order integer");
  await client.query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY pinned_at ASC, id ASC) - 1 AS pinned_order
      FROM registry_views
      WHERE pinned_at IS NOT NULL
    )
    UPDATE registry_views
    SET pinned_order = ranked.pinned_order
    FROM ranked
    WHERE registry_views.id = ranked.id
      AND registry_views.pinned_order IS NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS registry_views_pinned_order_unique
    ON registry_views (pinned_order)
    WHERE pinned_order IS NOT NULL
  `);
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}