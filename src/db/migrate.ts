import "dotenv/config";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb, closeDb } from "./connection.js";
import path from "path";

/** Run database migrations against external MySQL */
export async function runMigrations(): Promise<void> {
  console.log("[migrate] Running database migrations...");
  const db = getDb();
  await migrate(db as any, {
    migrationsFolder: path.join(__dirname, "migrations"),
  });
  console.log("[migrate] Migrations completed successfully.");
}

// Allow running as a standalone script
const isMainModule = process.argv[1]?.endsWith("migrate.js") || process.argv[1]?.endsWith("migrate.ts");
if (isMainModule) {
  runMigrations()
    .then(() => closeDb())
    .catch((err) => {
      console.error("[migrate] Migration failed:", err);
      process.exit(1);
    });
}
