// src/routes/device-token.routes.ts
//
// Device Token Routes (semua 🔒 Protected — butuh authMiddleware di consumer):
//   POST   /device-token  — Register FCM token baru
//   DELETE /device-token  — Hapus FCM token (saat logout)
//   GET    /device-token  — List semua token aktif user (debug)

import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, and } from "drizzle-orm";
import { deviceTokens } from "../db/schema";
import {
  registerDeviceTokenRoute,
  deleteDeviceTokenRoute,
  listDeviceTokensRoute,
} from "../openapi/routes";
import { logAnalytics } from "../utils/analytics";
import type { NotifyBindings, NotifyVariables } from "../types";

export const deviceTokenRoutes = new OpenAPIHono<{
  Bindings: NotifyBindings;
  Variables: NotifyVariables;
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
  const { token, platform } = c.req.valid("json");
  const userId = c.get("userId");
  const db = c.var.db;

  try {
    // Cek apakah token sudah ada di DB
    const [existing] = await db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.token, token))
      .limit(1);

    let result;

    if (existing) {
      // Update lastUsedAt & userId (case: user login di device yang sebelumnya dipakai orang lain)
      [result] = await db
        .update(deviceTokens)
        .set({
          userId,
          platform,
          lastUsedAt: new Date(),
        })
        .where(eq(deviceTokens.token, token))
        .returning();
    } else {
      // Insert baru
      [result] = await db
        .insert(deviceTokens)
        .values({ userId, token, platform })
        .returning();
    }

    logAnalytics(c.env.ANALYTICS, {
      event: "device_token_registered",
      userId,
      metadata: { platform },
    });

    return c.json(
      {
        data: {
          ...result,
          platform: result.platform as "android" | "ios" | "web",
          createdAt: result.createdAt.toISOString(),
          lastUsedAt: result.lastUsedAt.toISOString(),
        },
      },
      201,
    );
  } catch (err: any) {
    console.error("Error registering device token:", err);
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
  const db = c.var.db;

  try {
    // Pastikan token memang milik userId yang sedang login
    const [existing] = await db
      .select({ userId: deviceTokens.userId })
      .from(deviceTokens)
      .where(eq(deviceTokens.token, token))
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
      .delete(deviceTokens)
      .where(
        and(eq(deviceTokens.token, token), eq(deviceTokens.userId, userId)),
      );

    logAnalytics(c.env.ANALYTICS, {
      event: "device_token_deleted",
      userId,
    });

    return c.json({ data: { message: "Token berhasil dihapus" } }, 200);
  } catch (err: any) {
    console.error("Error deleting device token:", err);
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
  const db = c.var.db;

  try {
    const tokens = await db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId));

    return c.json(
      {
        data: tokens.map((t) => ({
          ...t,
          platform: t.platform as "android" | "ios" | "web",
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt.toISOString(),
        })),
      },
      200,
    );
  } catch (err: any) {
    console.error("Error listing device tokens:", err);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Gagal memuat daftar token" } },
      500,
    );
  }
});
