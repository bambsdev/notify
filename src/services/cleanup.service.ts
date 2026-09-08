// src/services/cleanup.service.ts
import { Client } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { lt, or, isNull, isNotNull } from "drizzle-orm";
import * as pgSchema from "../db/pg/schema";
import * as d1Schema from "../db/d1/schema";
import type { D1DB, NotifyLogger } from "../types";

export interface CleanupOptions {
  deleteExpiredAfterDays?: number;
  logger?: NotifyLogger;
}

// ── PostgreSQL Cleanup Functions ──────────────────────────────────────────────

/**
 * Helper untuk menghapus notifikasi yang sudah kedaluwarsa via Scheduled Worker / Cron Job (PostgreSQL).
 */
export async function cleanupExpiredNotifications(
  connectionString: string,
  opts?: CleanupOptions,
): Promise<{ deleted: number }> {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const db = drizzlePg(client, { schema: pgSchema, logger: false });
    const olderThanDays = opts?.deleteExpiredAfterDays ?? 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(pgSchema.notifications)
      .where(
        or(
          andCondition(
            isNotNull(pgSchema.notifications.expiresAt),
            lt(pgSchema.notifications.expiresAt, new Date()),
          ),
          andCondition(
            isNull(pgSchema.notifications.expiresAt),
            lt(pgSchema.notifications.createdAt, cutoffDate),
          ),
        ),
      );

    const count = result.rowCount ?? 0;
    opts?.logger?.info?.(
      `[cron] Expired notifications cleaned up (PG). Rows affected: ${count}`,
      { event: "cron_cleanup_notifications_success", rowCount: count },
    );
    return { deleted: count };
  } catch (error) {
    opts?.logger?.error?.(
      "[cron] Error cleaning up expired notifications (PG)",
      { event: "cron_cleanup_notifications_failed" },
      error,
    );
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

// ── Cloudflare D1 Cleanup Functions ───────────────────────────────────────────

function getD1Db(d1OrDb: D1Database | D1DB): D1DB {
  if ("batch" in d1OrDb && "exec" in d1OrDb && "prepare" in d1OrDb) {
    return drizzleD1(d1OrDb as D1Database, { schema: d1Schema, logger: false }) as D1DB;
  }
  return d1OrDb as D1DB;
}

/**
 * Helper untuk menghapus notifikasi yang sudah kedaluwarsa via Scheduled Worker / Cron Job (Cloudflare D1).
 */
export async function cleanupExpiredNotificationsD1(
  d1OrDb: D1Database | D1DB,
  opts?: CleanupOptions,
): Promise<{ deleted: number }> {
  try {
    const db = getD1Db(d1OrDb);
    const olderThanDays = opts?.deleteExpiredAfterDays ?? 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(d1Schema.notifications)
      .where(
        or(
          andCondition(
            isNotNull(d1Schema.notifications.expiresAt),
            lt(d1Schema.notifications.expiresAt, new Date()),
          ),
          andCondition(
            isNull(d1Schema.notifications.expiresAt),
            lt(d1Schema.notifications.createdAt, cutoffDate),
          ),
        ),
      )
      .returning({ id: d1Schema.notifications.id });

    const count = result.length;
    opts?.logger?.info?.(
      `[cron] Expired notifications cleaned up (D1). Rows affected: ${count}`,
      { event: "cron_cleanup_notifications_success", rowCount: count },
    );
    return { deleted: count };
  } catch (error) {
    opts?.logger?.error?.(
      "[cron] Error cleaning up expired notifications (D1)",
      { event: "cron_cleanup_notifications_failed" },
      error,
    );
    throw error;
  }
}

// Helper to avoid circular/loose import issues with drizzle and/or
import { and as andCondition } from "drizzle-orm";
