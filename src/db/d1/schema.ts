// src/db/d1/schema.ts
import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * deviceTokens
 * Menyimpan FCM device token per user per device.
 * Satu user bisa punya banyak token (multi-device).
 */
export const deviceTokens = sqliteTable(
  "device_tokens",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    token: text("token").notNull().unique(), // FCM registration token or Web Push endpoint
    platform: text("platform").notNull(), // "android" | "ios" | "web"
    provider: text("provider").notNull().default("fcm"), // "fcm" | "webpush"
    subscriptionKeys: text("subscription_keys", { mode: "json" }).$type<{
      p256dh: string;
      auth: string;
    }>(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("device_tokens_user_id_idx").on(table.userId),
  }),
);

/**
 * notifications
 * Menyimpan in-app notification per user.
 * FCM push tidak disimpan di sini (fire-and-forget).
 * In-app notification yang juga dikirim via FCM akan punya fcmMessageId.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, string>>(),
    isRead: integer("is_read", { mode: "boolean" }).default(false).notNull(),
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
  },
  (table) => ({
    userIdIdx: index("notifications_user_id_idx").on(table.userId),
    userUnreadIdx: index("notifications_user_unread_idx").on(
      table.userId,
      table.isRead,
    ),
    createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
    expiresAtIdx: index("notifications_expires_at_idx").on(table.expiresAt),
  }),
);

export const schema = { deviceTokens, notifications };
