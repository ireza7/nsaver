import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { env } from "./src/config/env.js";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "mysql",
  dbCredentials: {
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
  },
});
