// src/db/schema.ts
import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * deviceTokens
 * Menyimpan FCM device token per user per device.
 * Satu user bisa punya banyak token (multi-device).
 */
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    token: text("token").notNull().unique(), // FCM registration token
    platform: text("platform").notNull(), // "android" | "ios" | "web"
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
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
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    data: jsonb("data").$type<Record<string, string>>(),
    isRead: boolean("is_read").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    fcmMessageId: text("fcm_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index("notifications_user_id_idx").on(table.userId),
    userUnreadIdx: index("notifications_user_unread_idx").on(
      table.userId,
      table.isRead,
    ),
    createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
  }),
);

export const schema = { deviceTokens, notifications };
