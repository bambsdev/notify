// src/index.ts
//
// Barrel export — @bambsdev/notify
// Consumer apps import everything from this single entry point.

// ── Routes ────────────────────────────────────────────────────────────────────
export { notifyRoutes } from "./routes/notification.routes";
export { deviceTokenRoutes } from "./routes/device-token.routes";

// ── Middleware ─────────────────────────────────────────────────────────────────
export { dbMiddleware } from "./db/client";
export { customLogger } from "./utils/logger";

// ── Services (reusable untuk consumer app) ────────────────────────────────────
export { FCMService } from "./services/fcm.service";
export {
  NotificationService,
  cleanupExpiredNotifications,
} from "./services/notification.service";

// ── DB Schema (consumer needs this for drizzle migrations) ────────────────────
export { deviceTokens, notifications, schema } from "./db/schema";
export { createDb } from "./db/client";
export type { DB } from "./db/client";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  NotifyBindings,
  NotifyVariables,
  SendPushOptions,
  SendPushResult,
  CreateNotificationOptions,
  FCMPayload,
  FCMSendResult,
  FCMBatchResult,
} from "./types";

// ── Utils ─────────────────────────────────────────────────────────────────────
export { logAnalytics, type NotifyAnalyticsEvent } from "./utils/analytics";
export { fail, type AppError } from "./utils/error";
