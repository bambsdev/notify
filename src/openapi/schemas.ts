// src/openapi/schemas.ts
//
// Zod schemas dengan .openapi() annotation untuk validasi + OpenAPI spec.
// PENTING: Import `z` dari `@hono/zod-openapi`, BUKAN dari `zod` langsung.

import { z } from "@hono/zod-openapi";

// ── Request Schemas ──────────────────────────────────────────────

export const RegisterDeviceTokenBodySchema = z
  .object({
    token: z
      .string()
      .min(1, "token wajib diisi")
      .openapi({ example: "fMq3R...xyz" }),
    platform: z.enum(["android", "ios", "web"]).openapi({ example: "android" }),
  })
  .openapi("RegisterDeviceTokenBody");

export const DeleteDeviceTokenBodySchema = z
  .object({
    token: z
      .string()
      .min(1, "token wajib diisi")
      .openapi({ example: "fMq3R...xyz" }),
  })
  .openapi("DeleteDeviceTokenBody");

export const ListNotificationsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .min(1)
      .max(50)
      .default(20)
      .openapi({ example: 20 }),
    cursor: z
      .string()
      .uuid()
      .optional()
      .openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    onlyUnread: z.coerce.boolean().default(false).openapi({ example: false }),
  })
  .openapi("ListNotificationsQuery");

// ── Response Schemas ─────────────────────────────────────────────

export const NotificationSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string(),
    title: z.string(),
    body: z.string(),
    imageUrl: z.string().nullable(),
    data: z.record(z.string(), z.string()).nullable(),
    isRead: z.boolean(),
    readAt: z.string().datetime().nullable(),
    fcmMessageId: z.string().nullable(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  })
  .openapi("Notification");

export const DeviceTokenSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string(),
    token: z.string(),
    platform: z.enum(["android", "ios", "web"]),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime(),
  })
  .openapi("DeviceToken");

export const PaginatedNotificationsSchema = z
  .object({
    data: z.array(NotificationSchema),
    pagination: z.object({
      nextCursor: z.string().uuid().nullable(),
      hasMore: z.boolean(),
    }),
  })
  .openapi("PaginatedNotifications");

export const UnreadCountSchema = z
  .object({
    data: z.object({ count: z.number() }),
  })
  .openapi("UnreadCount");

export const SuccessSchema = z
  .object({
    data: z.object({
      message: z.string().openapi({ example: "Operasi berhasil" }),
    }),
  })
  .openapi("SuccessResponse");

export const SuccessWithCountSchema = z
  .object({
    data: z.object({ count: z.number() }),
  })
  .openapi("SuccessWithCount");

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z.string().openapi({ example: "token wajib diisi" }),
    }),
  })
  .openapi("ErrorResponse");
