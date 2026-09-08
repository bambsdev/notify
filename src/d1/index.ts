// src/d1/index.ts
//
// Cloudflare D1 (SQLite) Notify Stack for @bambsdev/notify/d1

// ── DB Schema & Client ────────────────────────────────────────────────────────
export * as schema from "../db/d1/schema";
export { deviceTokens, notifications } from "../db/d1/schema";
export {
  createD1Db,
  createD1Db as createDb,
  d1Middleware,
  d1Middleware as dbMiddleware,
} from "../db/d1/client";
export type { DB } from "../db/d1/client";

// ── Routes ────────────────────────────────────────────────────────────────────
export { deviceTokenRoutes } from "../routes/d1/device-token.routes";
export { notifyRoutes } from "../routes/d1/notification.routes";

// ── Services ──────────────────────────────────────────────────────────────────
export { NotificationService } from "./notification.service";
export {
  cleanupExpiredNotificationsD1,
  cleanupExpiredNotificationsD1 as cleanupExpiredNotifications,
} from "../services/cleanup.service";
export { FCMService } from "../services/fcm.service";
export { WebPushService } from "../services/webpush.service";

// ── Middleware & Utils ────────────────────────────────────────────────────────
export { customLogger, getLogger } from "../utils/logger";
export { logAnalytics, type NotifyAnalyticsEvent } from "../utils/analytics";
export { fail, type AppError } from "../utils/error";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  D1DB,
  D1Bindings,
  D1Bindings as Bindings,
  D1Bindings as NotifyBindings,
  D1Variables,
  D1Variables as Variables,
  D1Variables as NotifyVariables,
  NotifyLogger,
  SendPushOptions,
  SendPushResult,
  CreateNotificationOptions,
  FCMPayload,
  FCMSendResult,
  FCMBatchResult,
  WebPushSubscription,
} from "../types";
