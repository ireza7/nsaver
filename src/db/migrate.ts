import "dotenv/config";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb, closeDb } from "./connection.js";
import path from "path";

async function runMigrations() {
  console.log("[migrate] Running database migrations...");
  try {
    const db = getDb();
    await migrate(db as any, {
      migrationsFolder: path.join(__dirname, "migrations"),
    });
    console.log("[migrate] Migrations completed successfully.");
  } catch (err) {
    console.error("[migrate] Migration failed:", err);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

runMigrations();
