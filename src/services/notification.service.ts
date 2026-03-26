// src/services/notification.service.ts
//
// NotificationService — CRUD in-app notifications + FCM push integration.

import {
  eq,
  and,
  lt,
  or,
  desc,
  sql,
  isNull,
  isNotNull,
} from "drizzle-orm";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { deviceTokens, notifications, schema } from "../db/schema";
import type { FCMService } from "./fcm.service";
import type { DB } from "../db/client";
import type { CreateNotificationOptions } from "../types";
import { logAnalytics, type NotifyAnalyticsEvent } from "../utils/analytics";

export class NotificationService {
  constructor(
    private db: DB,
    private fcm: FCMService,
    private analytics: AnalyticsEngineDataset,
  ) {}

  /**
   * Buat in-app notification.
   * Jika options.withPush = true, otomatis fetch semua device token user
   * dan kirim FCM push. Token invalid akan dihapus dari DB.
   */
  async create(options: CreateNotificationOptions) {
    // 1. Insert notifikasi ke DB
    const [notification] = await this.db
      .insert(notifications)
      .values({
        userId: options.userId,
        title: options.title,
        body: options.body,
        imageUrl: options.imageUrl ?? null,
        data: options.data ?? null,
        expiresAt: options.expiresAt ?? null,
      })
      .returning();

    logAnalytics(this.analytics, {
      event: "notification_created",
      userId: options.userId,
    });

    // 2. Jika withPush = true, kirim FCM push ke semua device user
    if (options.withPush) {
      const tokens = await this.db
        .select({ token: deviceTokens.token })
        .from(deviceTokens)
        .where(eq(deviceTokens.userId, options.userId));

      if (tokens.length > 0) {
        const tokenStrings = tokens.map((t) => t.token);
        const result = await this.fcm.sendToTokens(tokenStrings, {
          title: options.title,
          body: options.body,
          imageUrl: options.imageUrl,
          data: options.data,
        });

        // Update fcmMessageId jika berhasil
        if (result.successCount > 0) {
          logAnalytics(this.analytics, {
            event: "push_sent",
            userId: options.userId,
            doubles: [result.successCount],
          });
        }

        if (result.failureCount > 0) {
          logAnalytics(this.analytics, {
            event: "push_failed",
            userId: options.userId,
            doubles: [result.failureCount],
          });
        }

        // Hapus token yang sudah tidak valid
        if (result.failedTokens.length > 0) {
          await this.pruneInvalidTokens(result.failedTokens);
        }
      }
    }

    return notification;
  }

  /**
   * Ambil daftar notifikasi user dengan cursor-based pagination.
   * Filter: isRead, exclude expired.
   * Default: 20 item, urut createdAt DESC.
   */
  async list(
    userId: string,
    opts?: {
      limit?: number;
      cursor?: string;
      onlyUnread?: boolean;
    },
  ) {
    const limit = Math.min(opts?.limit ?? 20, 50);
    const conditions = [
      eq(notifications.userId, userId),
      // Exclude expired notifications
      or(
        isNull(notifications.expiresAt),
        sql`${notifications.expiresAt} > NOW()`,
      ),
    ];

    if (opts?.onlyUnread) {
      conditions.push(eq(notifications.isRead, false));
    }

    // Cursor-based: ambil notifikasi yang createdAt < cursor notification's createdAt
    if (opts?.cursor) {
      const cursorNotif = await this.db
        .select({ createdAt: notifications.createdAt })
        .from(notifications)
        .where(eq(notifications.id, opts.cursor))
        .limit(1);

      if (cursorNotif.length > 0) {
        conditions.push(
          lt(notifications.createdAt, cursorNotif[0].createdAt),
        );
      }
    }

    const items = await this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1); // +1 untuk cek hasMore

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore
      ? resultItems[resultItems.length - 1].id
      : null;

    return { items: resultItems, nextCursor, hasMore };
  }

  /**
   * Tandai satu notifikasi sebagai sudah dibaca.
   * Validasi: notifikasi harus milik userId yang tepat.
   */
  async markRead(notificationId: string, userId: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: notifications.id, userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1);

    if (!existing) {
      throw Object.assign(new Error("Notifikasi tidak ditemukan"), {
        code: "NOT_FOUND",
        status: 404,
      });
    }

    if (existing.userId !== userId) {
      throw Object.assign(
        new Error("Notifikasi bukan milik user ini"),
        { code: "FORBIDDEN", status: 403 },
      );
    }

    await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notifications.id, notificationId));

    logAnalytics(this.analytics, {
      event: "notification_read",
      userId,
    });
  }

  /**
   * Tandai semua notifikasi user sebagai sudah dibaca.
   */
  async markAllRead(userId: string): Promise<{ count: number }> {
    const result = await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
        ),
      );

    const count = result.rowCount ?? 0;

    logAnalytics(this.analytics, {
      event: "notifications_read_all",
      userId,
      doubles: [count],
    });

    return { count };
  }

  /**
   * Hitung jumlah notifikasi yang belum dibaca.
   * Digunakan untuk badge counter di UI.
   */
  async unreadCount(userId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
          or(
            isNull(notifications.expiresAt),
            sql`${notifications.expiresAt} > NOW()`,
          ),
        ),
      );

    return result?.count ?? 0;
  }

  /**
   * Hapus notifikasi yang sudah expired atau lebih tua dari N hari.
   * Dipanggil oleh cron job harian.
   */
  async deleteExpired(olderThanDays: number = 30): Promise<{ deleted: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.db
      .delete(notifications)
      .where(
        or(
          // Notifikasi yang expiresAt sudah lewat
          and(
            isNotNull(notifications.expiresAt),
            lt(notifications.expiresAt, new Date()),
          ),
          // Notifikasi yang lebih tua dari N hari
          lt(notifications.createdAt, cutoffDate),
        ),
      );

    const deleted = result.rowCount ?? 0;

    logAnalytics(this.analytics, {
      event: "cleanup_expired",
      doubles: [deleted],
    });

    return { deleted };
  }

  /**
   * Hapus device token yang sudah tidak valid dari DB.
   * Dipanggil setelah FCMService return failedTokens.
   */
  async pruneInvalidTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    for (const token of tokens) {
      await this.db
        .delete(deviceTokens)
        .where(eq(deviceTokens.token, token));
    }
  }
}

// ── Standalone Cleanup Function (untuk cron) ──────────────────────────────────

/**
 * Cleanup expired notifications. Dipanggil oleh consumer app di scheduled handler.
 * Creates its own DB connection (same pattern as auth's cleanupExpiredTokens).
 */
export async function cleanupExpiredNotifications(
  connectionString: string,
  opts?: { deleteExpiredAfterDays?: number },
): Promise<void> {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const db = drizzle(client, { schema, logger: false });
    const olderThanDays = opts?.deleteExpiredAfterDays ?? 30;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(notifications)
      .where(
        or(
          and(
            isNotNull(notifications.expiresAt),
            lt(notifications.expiresAt, new Date()),
          ),
          lt(notifications.createdAt, cutoffDate),
        ),
      );

    console.log(
      `[cron] Expired notifications cleaned up. Rows affected: ${result.rowCount}`,
    );
  } catch (error) {
    console.error("[cron] Error cleaning up expired notifications:", error);
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}
