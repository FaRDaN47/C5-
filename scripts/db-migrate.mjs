import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Set DATABASE_URL_UNPOOLED or DATABASE_URL before migrating.");
}

const pool = new Pool({ connectionString, max: 1 });
const migrationsDirectory = fileURLToPath(
  new URL("../db/migrations/", import.meta.url),
);

try {
  const client = await pool.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS garageos_meta");
    await client.query(`
      CREATE TABLE IF NOT EXISTS garageos_meta.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const migration of migrations) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "garageos-schema-migrations",
        ]);
        const applied = await client.query(
          "SELECT 1 FROM garageos_meta.schema_migrations WHERE version = $1",
          [migration],
        );
        if (applied.rowCount) {
          await client.query("COMMIT");
          continue;
        }

        const sql = await readFile(
          new URL(`../db/migrations/${migration}`, import.meta.url),
          "utf8",
        );
        await client.query(sql);
        await client.query(
          "INSERT INTO garageos_meta.schema_migrations (version) VALUES ($1)",
          [migration],
        );
        await client.query("COMMIT");
        console.log(`Applied ${migration}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
} catch (error) {
  console.error(
    "Database migration failed:",
    error instanceof Error ? error.message : "Unexpected migration error.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
