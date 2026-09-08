// src/routes/factory/device-token.factory.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, and } from "drizzle-orm";
import {
  registerDeviceTokenRoute,
  deleteDeviceTokenRoute,
  listDeviceTokensRoute,
} from "../../openapi/routes";
import { logAnalytics } from "../../utils/analytics";
import { getLogger } from "../../utils/logger";
import type { SharedNotifyBindings, NotifyLogger } from "../../types";

export function createDeviceTokenRoutes<
  TBindings extends SharedNotifyBindings = SharedNotifyBindings,
  TVariables extends { db: any; userId: string; logger?: NotifyLogger } = any,
>(deviceTokensTable: any) {
  const deviceTokenRoutes = new OpenAPIHono<{
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

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  POST /device-token                         🔒 Protected     ║
  // ╚══════════════════════════════════════════════════════════════╝

  deviceTokenRoutes.openapi(registerDeviceTokenRoute, async (c) => {
    const { token, platform, provider, keys } = c.req.valid("json");
    const userId = c.get("userId");
    if (!userId) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "User ID tidak ditemukan" } },
        401,
      );
    }
    const db = c.var.db;

    try {
      // Atomic upsert (eliminer race condition TOCTOU)
      const [result] = await db
        .insert(deviceTokensTable)
        .values({
          userId,
          token,
          platform,
          provider: provider ?? "fcm",
          subscriptionKeys: keys ?? null,
          lastUsedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: deviceTokensTable.token,
          set: {
            userId,
            platform,
            provider: provider ?? "fcm",
            subscriptionKeys: keys ?? null,
            lastUsedAt: new Date(),
          },
        })
        .returning();

      logAnalytics(c.env?.ANALYTICS, {
        event: "device_token_registered",
        userId,
        metadata: { platform },
      });

      return c.json(
        {
          data: {
            id: result.id,
            platform: result.platform as "android" | "ios" | "web",
          },
        },
        201,
      );
    } catch (err: any) {
      getLogger(c).error?.("Error registering device token", { userId }, err);
      return c.json(
        { error: { code: "INTERNAL_ERROR", message: "Gagal mendaftarkan token" } },
        500,
      );
    }
  });

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  DELETE /device-token                       🔒 Protected     ║
  // ╚══════════════════════════════════════════════════════════════╝

  deviceTokenRoutes.openapi(deleteDeviceTokenRoute, async (c) => {
    const { token } = c.req.valid("json");
    const userId = c.get("userId");
    if (!userId) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "User ID tidak ditemukan" } },
        401,
      );
    }
    const db = c.var.db;

    try {
      // Pastikan token memang milik userId yang sedang login
      const [existing] = await db
        .select({ userId: deviceTokensTable.userId })
        .from(deviceTokensTable)
        .where(eq(deviceTokensTable.token, token))
        .limit(1);

      if (existing && existing.userId !== userId) {
        return c.json(
          {
            error: { code: "FORBIDDEN", message: "Token bukan milik user ini" },
          },
          403,
        );
      }

      await db
        .delete(deviceTokensTable)
        .where(
          and(
            eq(deviceTokensTable.token, token),
            eq(deviceTokensTable.userId, userId),
          ),
        );

      logAnalytics(c.env?.ANALYTICS, {
        event: "device_token_deleted",
        userId,
      });

      return c.json({ data: { message: "Token berhasil dihapus" } }, 200);
    } catch (err: any) {
      getLogger(c).error?.("Error deleting device token", { userId }, err);
      return c.json(
        { error: { code: "INTERNAL_ERROR", message: "Gagal menghapus token" } },
        500,
      );
    }
  });

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  GET /device-token                          🔒 Protected     ║
  // ╚══════════════════════════════════════════════════════════════╝

  deviceTokenRoutes.openapi(listDeviceTokensRoute, async (c) => {
    const userId = c.get("userId");
    if (!userId) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "User ID tidak ditemukan" } },
        401,
      );
    }
    const db = c.var.db;

    try {
      const tokens = await db
        .select()
        .from(deviceTokensTable)
        .where(eq(deviceTokensTable.userId, userId));

      return c.json(
        {
          data: tokens.map((t: any) => {
            let keys = t.subscriptionKeys;
            if (typeof keys === "string") {
              try {
                keys = JSON.parse(keys);
              } catch {}
            }
            return {
              ...t,
              subscriptionKeys: keys ?? null,
              platform: t.platform as "android" | "ios" | "web",
              provider: t.provider as "fcm" | "webpush",
              createdAt: (t.createdAt instanceof Date
                ? t.createdAt
                : new Date(t.createdAt)
              ).toISOString(),
              lastUsedAt: (t.lastUsedAt instanceof Date
                ? t.lastUsedAt
                : new Date(t.lastUsedAt)
              ).toISOString(),
            };
          }),
        },
        200,
      );
    } catch (err: any) {
      getLogger(c).error?.("Error listing device tokens", { userId }, err);
      return c.json(
        { error: { code: "INTERNAL_ERROR", message: "Gagal memuat daftar token" } },
        500,
      );
    }
  });

  return deviceTokenRoutes;
}
