// src/routes/factory/notification.factory.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { FCMService } from "../../services/fcm.service";
import { WebPushService } from "../../services/webpush.service";
import {
  NotificationService,
  type NotifyTables,
} from "../../services/notification.service";
import {
  listNotificationsRoute,
  unreadCountRoute,
  markReadRoute,
  markAllReadRoute,
} from "../../openapi/routes";
import type { SharedNotifyBindings, NotifyLogger } from "../../types";

export function createNotificationRoutes<
  TBindings extends SharedNotifyBindings = SharedNotifyBindings,
  TVariables extends { db: any; userId: string; logger?: NotifyLogger } = any,
>(tables: NotifyTables, dialect: "pg" | "d1" = "pg") {
  const notifyRoutes = new OpenAPIHono<{
    Bindings: TBindings;
    Variables: TVariables;
  }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: result.error.issues[0]?.message || "Input tidak valid",
            },
          },
          400,
        );
      }
    },
  });

  // ── Helper: buat NotificationService instance ─────────────────────────────────

  function makeNotificationService(c: any): NotificationService {
    const db = c.var.db;
    const fcm =
      c.env?.FCM_PROJECT_ID && c.env?.FCM_SERVICE_ACCOUNT_KEY
        ? new FCMService(
            c.env.KV,
            c.env.FCM_PROJECT_ID,
            c.env.FCM_SERVICE_ACCOUNT_KEY,
          )
        : (undefined as unknown as FCMService);
    const webPush =
      c.env?.VAPID_PUBLIC_KEY && c.env?.VAPID_PRIVATE_KEY && c.env?.VAPID_SUBJECT
        ? new WebPushService(
            c.env.VAPID_PUBLIC_KEY,
            c.env.VAPID_PRIVATE_KEY,
            c.env.VAPID_SUBJECT,
          )
        : undefined;
    return new NotificationService(
      db,
      fcm,
      c.env?.ANALYTICS,
      webPush,
      tables,
      dialect,
    );
  }

  function errorResponse(c: any, err: any) {
    const status = err.status ?? 500;
    const code = err.code ?? "INTERNAL_ERROR";
    return c.json(
      { error: { code, message: err.message } },
      status,
    );
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  GET /notifications                         🔒 Protected     ║
  // ╚══════════════════════════════════════════════════════════════╝

  notifyRoutes.openapi(listNotificationsRoute, async (c) => {
    const { limit, cursor, onlyUnread } = c.req.valid("query");
    const userId = c.get("userId");
    if (!userId) {
      return errorResponse(c, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "User ID tidak ditemukan",
      });
    }
    const service = makeNotificationService(c);

    try {
      const result = await service.list(userId, { limit, cursor, onlyUnread });

      return c.json(
        {
          data: result.items.map((item: any) => ({
            ...item,
            createdAt: (item.createdAt instanceof Date
              ? item.createdAt
              : new Date(item.createdAt)
            ).toISOString(),
            readAt: item.readAt
              ? (item.readAt instanceof Date
                  ? item.readAt
                  : new Date(item.readAt)
                ).toISOString()
              : null,
            expiresAt: item.expiresAt
              ? (item.expiresAt instanceof Date
                  ? item.expiresAt
                  : new Date(item.expiresAt)
                ).toISOString()
              : null,
          })),
          pagination: {
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
    if (!userId) {
      return errorResponse(c, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "User ID tidak ditemukan",
      });
    }
    const service = makeNotificationService(c);

    try {
      const count = await service.unreadCount(userId);
      return c.json({ data: { count } }, 200);
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
    if (!userId) {
      return errorResponse(c, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "User ID tidak ditemukan",
      });
    }
    const service = makeNotificationService(c);

    try {
      await service.markRead(id, userId);
      return c.json(
        { data: { message: "Notifikasi ditandai telah dibaca" } },
        200,
      );
    } catch (err: any) {
      return errorResponse(c, err);
    }
  });

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  PUT /notifications/read-all                🔒 Protected     ║
  // ╚══════════════════════════════════════════════════════════════╝

  notifyRoutes.openapi(markAllReadRoute, async (c) => {
    const userId = c.get("userId");
    if (!userId) {
      return errorResponse(c, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "User ID tidak ditemukan",
      });
    }
    const service = makeNotificationService(c);

    try {
      const result = await service.markAllRead(userId);
      return c.json({ data: { count: result.count } }, 200);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  });

  return notifyRoutes;
}
