// src/index.ts
//
// Root export — @bambsdev/notify
//
// ⚠️ BREAKING CHANGE in v1.0.0:
// Database-specific implementations (routes, middleware, schemas, NotificationService)
// must be explicitly imported from either:
//   - "@bambsdev/notify/pg" (for PostgreSQL)
//   - "@bambsdev/notify/d1" (for Cloudflare D1 / SQLite)

// ── Shared Services ───────────────────────────────────────────────────────────
export { FCMService } from "./services/fcm.service";
export { WebPushService } from "./services/webpush.service";
export {
  NotificationService,
  BaseNotificationService,
} from "./services/notification.service";
export {
  cleanupExpiredNotifications,
  cleanupExpiredNotificationsD1,
} from "./services/cleanup.service";

// ── Shared Utils ──────────────────────────────────────────────────────────────
export { customLogger, getLogger } from "./utils/logger";
export { logAnalytics, type NotifyAnalyticsEvent } from "./utils/analytics";
export { fail, type AppError } from "./utils/error";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  PgDB,
  D1DB,
  AnyNotifyDB,
  DB,
  SharedNotifyBindings,
  PgBindings,
  D1Bindings,
  NotifyBindings,
  PgVariables,
  D1Variables,
  NotifyVariables,
  NotifyLogger,
  SendPushOptions,
  SendPushResult,
  CreateNotificationOptions,
  FCMPayload,
  FCMSendResult,
  FCMBatchResult,
  WebPushSubscription,
  ServiceAccountKey,
} from "./types";
