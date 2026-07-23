// src/types.ts
//
// All public types for @bambsdev/notify.

import type { DB } from "./db/client";

// ── Cloudflare Worker Bindings ────────────────────────────────────────────────

export interface NotifyBindings {
  // Hyperdrive — connection pool ke Neon PostgreSQL
  HYPERDRIVE: Hyperdrive;

  // KV — menyimpan FCM OAuth2 access token (TTL-based caching)
  KV: KVNamespace;

  // Analytics Engine — audit log & metrics notifikasi
  ANALYTICS: AnalyticsEngineDataset;

  // FCM Service Account credentials (set via `wrangler secret put`)
  FCM_SERVICE_ACCOUNT_KEY: string; // JSON string dari Google service account
  FCM_PROJECT_ID: string; // Firebase project ID

  // VAPID credentials untuk Native Web Push
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string; // mailto: format (e.g. mailto:admin@example.com)

  // Local dev bypass
  LOCAL_DATABASE_URL?: string;
}

// ── Web Push (VAPID) ──────────────────────────────────────────────────────────

export interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ── Logger Interface (Industry Standard Dependency Injection) ─────────────────

export interface NotifyLogger {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>, error?: Error | unknown) => void;
}

// ── Hono Context Variables (injected per-request) ─────────────────────────────

export interface NotifyVariables {
  db: DB;
  userId: string; // Di-inject oleh authMiddleware dari @bambsdev/auth
  logger?: NotifyLogger;
}

// ── FCM Push ──────────────────────────────────────────────────────────────────

export interface SendPushOptions {
  /** Token FCM spesifik satu device */
  token?: string;
  /** Kirim ke semua token milik userId (semua device) */
  userId?: string;
  /** Kirim ke FCM topic */
  topic?: string;
  title: string;
  body: string;
  imageUrl?: string;
  /** Data payload tambahan untuk deep-link */
  data?: Record<string, string>;
}

export interface SendPushResult {
  success: boolean;
  messageId?: string;
  failedTokens?: string[];
  error?: string;
}

export interface CreateNotificationOptions {
  userId: string;
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  expiresAt?: Date;
  /** Jika true, akan otomatis kirim FCM push ke semua device user */
  withPush?: boolean;
}

// ── Internal Types ────────────────────────────────────────────────────────────

export interface FCMPayload {
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
}

export interface FCMSendResult {
  success: boolean;
  messageId?: string;
  invalidToken?: boolean;
  error?: string;
}

export interface FCMBatchResult {
  successCount: number;
  failureCount: number;
  failedTokens: string[];
}

export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}
