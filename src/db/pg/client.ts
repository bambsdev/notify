// src/db/pg/client.ts
//
// Lazy init per-request: buat Client baru tiap request, serahkan pooling ke Hyperdrive.

import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { createMiddleware } from "hono/factory";
import * as schema from "./schema";
import type { PgBindings, PgVariables, PgDB } from "../../types";

export function createDb(connectionString: string): PgDB {
  const client = new Client({ connectionString });
  return drizzle(client, { schema, logger: false }) as PgDB;
}

export type { PgDB as DB, PgDB };

export const dbMiddleware = createMiddleware<{
  Bindings: PgBindings;
  Variables: PgVariables;
}>(async (c, next) => {
  const connectionString =
    c.env?.HYPERDRIVE?.connectionString || c.env?.LOCAL_DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Database connection string is missing. Please provide LOCAL_DATABASE_URL or HYPERDRIVE binding.",
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  const db = drizzle(client, { schema, logger: false }) as PgDB;
  c.set("db", db);

  try {
    await next();
  } finally {
    client.end().catch(() => {});
  }
});

export const pgMiddleware = dbMiddleware;
