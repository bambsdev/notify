// src/pg/index.ts
//
// PostgreSQL Notify Stack for @bambsdev/notify/pg

// ── DB Schema & Client ────────────────────────────────────────────────────────
export * as schema from "../db/pg/schema";
export { deviceTokens, notifications } from "../db/pg/schema";
export {
  createDb,
  dbMiddleware,
  dbMiddleware as pgMiddleware,
} from "../db/pg/client";
export type { DB } from "../db/pg/client";

// ── Routes ────────────────────────────────────────────────────────────────────
export { deviceTokenRoutes } from "../routes/pg/device-token.routes";
export { notifyRoutes } from "../routes/pg/notification.routes";

// ── Services ──────────────────────────────────────────────────────────────────
export { NotificationService } from "./notification.service";
export { cleanupExpiredNotifications } from "../services/cleanup.service";
export { FCMService } from "../services/fcm.service";
export { WebPushService } from "../services/webpush.service";

// ── Middleware & Utils ────────────────────────────────────────────────────────
export { customLogger, getLogger } from "../utils/logger";
export { logAnalytics, type NotifyAnalyticsEvent } from "../utils/analytics";
export { fail, type AppError } from "../utils/error";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  PgDB,
  PgBindings,
  PgBindings as Bindings,
  PgBindings as NotifyBindings,
  PgVariables,
  PgVariables as Variables,
  PgVariables as NotifyVariables,
  NotifyLogger,
  SendPushOptions,
  SendPushResult,
  CreateNotificationOptions,
  FCMPayload,
  FCMSendResult,
  FCMBatchResult,
  WebPushSubscription,
  WebPushPayload,
} from "../types";
