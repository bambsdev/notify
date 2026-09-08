// src/services/notification.service.ts
//
// NotificationService — CRUD in-app notifications + FCM push integration.
// Supports both PostgreSQL and Cloudflare D1 (SQLite).

import {
  eq,
  and,
  lt,
  gt,
  or,
  desc,
  isNull,
  isNotNull,
  inArray,
  count,
} from "drizzle-orm";
import * as pgSchema from "../db/pg/schema";
import type { FCMService } from "./fcm.service";
import type { WebPushService } from "./webpush.service";
import type { CreateNotificationOptions } from "../types";
import { logAnalytics } from "../utils/analytics";

export interface NotifyTables {
  deviceTokens: any;
  notifications: any;
}

export class NotificationService<TDB = any> {
  protected tables: NotifyTables;

  constructor(
    protected db: TDB,
    protected fcm?: FCMService,
    protected analytics?: AnalyticsEngineDataset,
    protected webPush?: WebPushService,
    tables?: NotifyTables,
    protected dialect: "pg" | "d1" = "pg",
  ) {
    this.tables = tables ?? pgSchema;
  }

  /**
   * Buat in-app notification.
   * Jika options.withPush = true, otomatis fetch semua device token user
   * dan kirim FCM / Web Push. Token invalid akan dihapus dari DB.
   */
  async create(options: CreateNotificationOptions) {
    // 1. Insert notifikasi ke DB
    const insertQuery = (this.db as any)
      .insert(this.tables.notifications)
      .values({
        userId: options.userId,
        title: options.title,
        body: options.body,
        data: options.data ?? null,
        expiresAt: options.expiresAt ?? null,
      });

    const [notification] = typeof insertQuery.returning === "function"
      ? await insertQuery.returning()
      : await insertQuery;

    if (this.analytics) {
      logAnalytics(this.analytics, {
        event: "notification_created",
        userId: options.userId,
      });
    }

    // 2. Jika withPush = true, kirim FCM / Web Push ke semua device user
    if (options.withPush) {
      const devices = await (this.db as any)
        .select({
          token: this.tables.deviceTokens.token,
          provider: this.tables.deviceTokens.provider,
          subscriptionKeys: this.tables.deviceTokens.subscriptionKeys,
        })
        .from(this.tables.deviceTokens)
        .where(eq(this.tables.deviceTokens.userId, options.userId));

      if (devices.length > 0) {
        const fcmTokens: string[] = [];
        const webpushDevices: Array<{
          endpoint: string;
          keys: { p256dh: string; auth: string };
        }> = [];

        for (const d of devices) {
          let keys = d.subscriptionKeys;
          if (typeof keys === "string") {
            try {
              keys = JSON.parse(keys);
            } catch {}
          }

          if (
            d.provider === "webpush" &&
            keys?.p256dh &&
            keys?.auth
          ) {
            webpushDevices.push({
              endpoint: d.token,
              keys,
            });
          } else {
            fcmTokens.push(d.token);
          }
        }

        const invalidTokensToPrune: string[] = [];

        // FCM Push
        if (fcmTokens.length > 0 && this.fcm) {
          const result = await this.fcm.sendToTokens(fcmTokens, {
            title: options.title,
            body: options.body,
            imageUrl: options.imageUrl,
            data: options.data,
          });

          if (this.analytics && result.successCount > 0) {
            logAnalytics(this.analytics, {
              event: "push_sent",
              userId: options.userId,
              doubles: [result.successCount],
            });
          }

          if (this.analytics && result.failureCount > 0) {
            logAnalytics(this.analytics, {
              event: "push_failed",
              userId: options.userId,
              doubles: [result.failureCount],
            });
          }

          if (result.failedTokens.length > 0) {
            invalidTokensToPrune.push(...result.failedTokens);
          }
        }

        // Web Push
        if (this.webPush && webpushDevices.length > 0) {
          const webpushResults = await Promise.allSettled(
            webpushDevices.map((wp) =>
              this.webPush!.sendNotification(wp, {
                title: options.title,
                body: options.body,
                imageUrl: options.imageUrl,
                data: options.data,
              }),
            ),
          );

          let wpSuccess = 0;
          let wpFailure = 0;

          webpushResults.forEach((res, idx) => {
            if (res.status === "fulfilled" && res.value.success) {
              wpSuccess++;
            } else {
              wpFailure++;
              if (res.status === "fulfilled" && res.value.invalidToken) {
                invalidTokensToPrune.push(webpushDevices[idx].endpoint);
              }
            }
          });

          if (this.analytics && wpSuccess > 0) {
            logAnalytics(this.analytics, {
              event: "push_sent",
              userId: options.userId,
              doubles: [wpSuccess],
            });
          }

          if (this.analytics && wpFailure > 0) {
            logAnalytics(this.analytics, {
              event: "push_failed",
              userId: options.userId,
              doubles: [wpFailure],
            });
          }
        }

        // Hapus token yang sudah tidak valid
        if (invalidTokensToPrune.length > 0) {
          await this.pruneInvalidTokens(invalidTokensToPrune);
        }
      }
    }

    return notification;
  }

  /**
   * Ambil daftar notifikasi user dengan cursor-based pagination.
   * Filter: isRead, exclude expired.
   * Default: 20 item, urut createdAt DESC, id DESC.
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
      eq(this.tables.notifications.userId, userId),
      // Exclude expired notifications
      or(
        isNull(this.tables.notifications.expiresAt),
        gt(this.tables.notifications.expiresAt, new Date()),
      ),
    ];

    if (opts?.onlyUnread) {
      conditions.push(eq(this.tables.notifications.isRead, false));
    }

    // Compound cursor pagination: (createdAt, id) < (cursor.createdAt, cursor.id)
    if (opts?.cursor) {
      const cursorNotif = await (this.db as any)
        .select({
          id: this.tables.notifications.id,
          createdAt: this.tables.notifications.createdAt,
        })
        .from(this.tables.notifications)
        .where(eq(this.tables.notifications.id, opts.cursor))
        .limit(1);

      if (cursorNotif.length > 0) {
        const cDate = cursorNotif[0].createdAt;
        const cId = cursorNotif[0].id;
        conditions.push(
          or(
            lt(this.tables.notifications.createdAt, cDate),
            and(
              eq(this.tables.notifications.createdAt, cDate),
              lt(this.tables.notifications.id, cId),
            ),
          )!,
        );
      }
    }

    const items = await (this.db as any)
      .select()
      .from(this.tables.notifications)
      .where(and(...conditions))
      .orderBy(
        desc(this.tables.notifications.createdAt),
        desc(this.tables.notifications.id),
      )
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
    const [existing] = await (this.db as any)
      .select({
        id: this.tables.notifications.id,
        userId: this.tables.notifications.userId,
      })
      .from(this.tables.notifications)
      .where(eq(this.tables.notifications.id, notificationId))
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

    await (this.db as any)
      .update(this.tables.notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(this.tables.notifications.id, notificationId));

    if (this.analytics) {
      logAnalytics(this.analytics, {
        event: "notification_read",
        userId,
      });
    }
  }

  /**
   * Tandai semua notifikasi user sebagai sudah dibaca.
   */
  async markAllRead(userId: string): Promise<{ count: number }> {
    const query = (this.db as any)
      .update(this.tables.notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(this.tables.notifications.userId, userId),
          eq(this.tables.notifications.isRead, false),
        ),
      );

    const result = typeof query.returning === "function"
      ? await query.returning({ id: this.tables.notifications.id })
      : await query;

    const count = Array.isArray(result)
      ? result.length
      : (result?.rowCount ?? 0);

    if (this.analytics) {
      logAnalytics(this.analytics, {
        event: "notifications_read_all",
        userId,
        doubles: [count],
      });
    }

    return { count };
  }

  /**
   * Hitung jumlah notifikasi yang belum dibaca.
   * Digunakan untuk badge counter di UI.
   */
  async unreadCount(userId: string): Promise<number> {
    const [result] = await (this.db as any)
      .select({ count: count() })
      .from(this.tables.notifications)
      .where(
        and(
          eq(this.tables.notifications.userId, userId),
          eq(this.tables.notifications.isRead, false),
          or(
            isNull(this.tables.notifications.expiresAt),
            gt(this.tables.notifications.expiresAt, new Date()),
          ),
        ),
      );

    return Number(result?.count ?? 0);
  }

  /**
   * Hapus notifikasi yang sudah expired atau lebih tua dari N hari (jika tanpa expiresAt).
   * Dipanggil oleh cron job harian.
   */
  async deleteExpired(olderThanDays: number = 30): Promise<{ deleted: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const query = (this.db as any)
      .delete(this.tables.notifications)
      .where(
        or(
          // Notifikasi yang expiresAt sudah lewat
          and(
            isNotNull(this.tables.notifications.expiresAt),
            lt(this.tables.notifications.expiresAt, new Date()),
          ),
          // Notifikasi tanpa expiresAt (default) yang lebih tua dari N hari
          and(
            isNull(this.tables.notifications.expiresAt),
            lt(this.tables.notifications.createdAt, cutoffDate),
          ),
        ),
      );

    const result = typeof query.returning === "function"
      ? await query.returning({ id: this.tables.notifications.id })
      : await query;

    const deleted = Array.isArray(result)
      ? result.length
      : (result?.rowCount ?? 0);

    if (this.analytics) {
      logAnalytics(this.analytics, {
        event: "cleanup_expired",
        doubles: [deleted],
      });
    }

    return { deleted };
  }

  /**
   * Hapus device token yang sudah tidak valid dari DB dalam 1 batch query.
   * Dipanggil setelah FCMService/WebPushService return failedTokens.
   */
  async pruneInvalidTokens(tokens: string[]): Promise<void> {
    if (!tokens || tokens.length === 0) return;

    await (this.db as any)
      .delete(this.tables.deviceTokens)
      .where(inArray(this.tables.deviceTokens.token, tokens));
  }
}

export { NotificationService as BaseNotificationService };
export { cleanupExpiredNotifications } from "./cleanup.service";
