// src/openapi/routes.ts
//
// createRoute() definitions untuk semua endpoint.

import { createRoute, z } from "@hono/zod-openapi";
import {
  RegisterDeviceTokenBodySchema,
  DeleteDeviceTokenBodySchema,
  ListNotificationsQuerySchema,
  PaginatedNotificationsSchema,
  UnreadCountSchema,
  DeviceTokenSchema,
  SuccessSchema,
  SuccessWithCountSchema,
  ErrorSchema,
} from "./schemas";

const bearerAuth = [{ bearerAuth: [] }];
const commonErrors = {
  401: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Unauthorized",
  },
  500: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Internal Server Error",
  },
};

// ── Device Token Routes ───────────────────────────────────────────────────────

export const registerDeviceTokenRoute = createRoute({
  method: "post",
  path: "/device-token",
  tags: ["Device Token"],
  summary: "Register FCM device token",
  description:
    "Daftarkan token setelah login atau saat Firebase SDK memberikan token baru.",
  security: bearerAuth,
  request: {
    body: {
      content: {
        "application/json": { schema: RegisterDeviceTokenBodySchema },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            data: DeviceTokenSchema,
          }),
        },
      },
      description: "Token terdaftar",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Validation Error",
    },
    ...commonErrors,
  },
});

export const deleteDeviceTokenRoute = createRoute({
  method: "delete",
  path: "/device-token",
  tags: ["Device Token"],
  summary: "Hapus FCM device token",
  description: "Hapus token saat user logout.",
  security: bearerAuth,
  request: {
    body: {
      content: {
        "application/json": { schema: DeleteDeviceTokenBodySchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: SuccessSchema },
      },
      description: "Token dihapus",
    },
    403: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Token bukan milik user ini",
    },
    ...commonErrors,
  },
});

export const listDeviceTokensRoute = createRoute({
  method: "get",
  path: "/device-token",
  tags: ["Device Token"],
  summary: "List semua device token aktif",
  description: "Untuk debug: melihat semua FCM token yang terdaftar milik user.",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(DeviceTokenSchema),
          }),
        },
      },
      description: "Daftar token",
    },
    ...commonErrors,
  },
});

// ── Notification Routes ───────────────────────────────────────────────────────

export const listNotificationsRoute = createRoute({
  method: "get",
  path: "/notifications",
  tags: ["Notifications"],
  summary: "List in-app notifications",
  description: "Cursor-based pagination. Urutkan createdAt DESC.",
  security: bearerAuth,
  request: { query: ListNotificationsQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: PaginatedNotificationsSchema },
      },
      description: "Daftar notifikasi",
    },
    ...commonErrors,
  },
});

export const unreadCountRoute = createRoute({
  method: "get",
  path: "/notifications/unread-count",
  tags: ["Notifications"],
  summary: "Jumlah notifikasi belum dibaca",
  description: "Untuk badge counter di ikon lonceng.",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: UnreadCountSchema } },
      description: "Unread count",
    },
    ...commonErrors,
  },
});

export const markReadRoute = createRoute({
  method: "put",
  path: "/notifications/{id}/read",
  tags: ["Notifications"],
  summary: "Tandai satu notifikasi sudah dibaca",
  security: bearerAuth,
  request: {
    params: z.object({
      id: z
        .string()
        .uuid()
        .openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: SuccessSchema },
      },
      description: "Berhasil",
    },
    403: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Bukan milik user ini",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Tidak ditemukan",
    },
    ...commonErrors,
  },
});

export const markAllReadRoute = createRoute({
  method: "put",
  path: "/notifications/read-all",
  tags: ["Notifications"],
  summary: "Tandai semua notifikasi sudah dibaca",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": { schema: SuccessWithCountSchema },
      },
      description: "Berhasil",
    },
    ...commonErrors,
  },
});
