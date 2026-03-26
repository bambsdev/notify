// src/routes/notification.routes.ts
//
// Notification Routes (semua 🔒 Protected — butuh authMiddleware di consumer):
//   GET  /notifications              — List in-app notifications (paginated)
//   GET  /notifications/unread-count — Ambil jumlah belum dibaca
//   PUT  /notifications/:id/read     — Tandai satu notifikasi sudah dibaca
//   PUT  /notifications/read-all     — Tandai semua sudah dibaca

import { OpenAPIHono } from "@hono/zod-openapi";
import { FCMService } from "../services/fcm.service";
import { NotificationService } from "../services/notification.service";
import {
  listNotificationsRoute,
  unreadCountRoute,
  markReadRoute,
  markAllReadRoute,
} from "../openapi/routes";
import type { NotifyBindings, NotifyVariables } from "../types";

export const notifyRoutes = new OpenAPIHono<{
  Bindings: NotifyBindings;
  Variables: NotifyVariables;
}>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false as const,
          error: "VALIDATION_ERROR",
          message: result.error.issues[0]?.message || "Input tidak valid",
        },
        400,
      );
    }
  },
});

// ── Helper: buat NotificationService instance ─────────────────────────────────

function makeNotificationService(c: any): NotificationService {
  const db = c.var.db;
  const fcm = new FCMService(
    c.env.KV,
    c.env.FCM_PROJECT_ID,
    c.env.FCM_SERVICE_ACCOUNT_KEY,
  );
  return new NotificationService(db, fcm, c.env.ANALYTICS);
}

function errorResponse(c: any, err: any) {
  const status = err.status ?? 500;
  const code = err.code ?? "INTERNAL_ERROR";
  return c.json(
    { success: false as const, error: code, message: err.message },
    status,
  );
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  GET /notifications                         🔒 Protected     ║
// ╚══════════════════════════════════════════════════════════════╝

notifyRoutes.openapi(listNotificationsRoute, async (c) => {
  const { limit, cursor, onlyUnread } = c.req.valid("query");
  const userId = c.get("userId");
  const service = makeNotificationService(c);

  try {
    const result = await service.list(userId, { limit, cursor, onlyUnread });

    return c.json(
      {
        success: true as const,
        data: {
          items: result.items.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            readAt: item.readAt ? item.readAt.toISOString() : null,
            expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
          })),
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        },
      },
      200,
    );
  } catch (err: any) {
    return errorResponse(c, err);
  }
});

// ╔══════════════════════════════════════════════════════════════╗
// ║  GET /notifications/unread-count            🔒 Protected     ║
// ╚══════════════════════════════════════════════════════════════╝

notifyRoutes.openapi(unreadCountRoute, async (c) => {
  const userId = c.get("userId");
  const service = makeNotificationService(c);

  try {
    const count = await service.unreadCount(userId);
    return c.json(
      { success: true as const, data: { count } },
      200,
    );
  } catch (err: any) {
    return errorResponse(c, err);
  }
});

// ╔══════════════════════════════════════════════════════════════╗
// ║  PUT /notifications/:id/read                🔒 Protected     ║
// ╚══════════════════════════════════════════════════════════════╝

notifyRoutes.openapi(markReadRoute, async (c) => {
  const { id } = c.req.valid("param");
  const userId = c.get("userId");
  const service = makeNotificationService(c);

  try {
    await service.markRead(id, userId);
    return c.json({ success: true as const }, 200);
  } catch (err: any) {
    return errorResponse(c, err);
  }
});

// ╔══════════════════════════════════════════════════════════════╗
// ║  PUT /notifications/read-all                🔒 Protected     ║
// ╚══════════════════════════════════════════════════════════════╝

notifyRoutes.openapi(markAllReadRoute, async (c) => {
  const userId = c.get("userId");
  const service = makeNotificationService(c);

  try {
    const result = await service.markAllRead(userId);
    return c.json(
      { success: true as const, data: { count: result.count } },
      200,
    );
  } catch (err: any) {
    return errorResponse(c, err);
  }
});
