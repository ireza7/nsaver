import { drizzle, MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

export type DbInstance = MySql2Database<typeof schema>;

let _db: DbInstance | null = null;
let _pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return _pool;
}

export function getDb(): DbInstance {
  if (!_db) {
    _db = drizzle(getPool(), { schema, mode: "default" }) as unknown as DbInstance;
  }
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

export { schema };
