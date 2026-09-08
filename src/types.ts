// src/types.ts
//
// All public types for @bambsdev/notify.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as pgSchema from "./db/pg/schema";
import type * as d1Schema from "./db/d1/schema";

// ── Database Types ────────────────────────────────────────────────────────────

export type PgDB = NodePgDatabase<typeof pgSchema>;
export type D1DB = DrizzleD1Database<typeof d1Schema>;
export type AnyNotifyDB = PgDB | D1DB;

// Backward-compatibility alias
export type DB = PgDB;

// ── Cloudflare Worker Bindings ────────────────────────────────────────────────

export interface SharedNotifyBindings {
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
}

export interface PgBindings extends SharedNotifyBindings {
  // Hyperdrive — connection pool ke Neon PostgreSQL
  HYPERDRIVE?: Hyperdrive;

  // Local dev bypass
  LOCAL_DATABASE_URL?: string;
}

export interface D1Bindings extends SharedNotifyBindings {
  // Cloudflare D1 Database binding
  DB: D1Database;
}

// Backward-compatibility / generic union type
export type NotifyBindings = PgBindings & Partial<D1Bindings>;

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
  error?: (message: string, metadata?: Record<string, unknown>, error?: unknown) => void;
}

// ── Hono Context Variables (injected per-request) ─────────────────────────────

export interface PgVariables {
  db: PgDB;
  userId: string; // Di-inject oleh authMiddleware
  logger?: NotifyLogger;
}

export interface D1Variables {
  db: D1DB;
  userId: string; // Di-inject oleh authMiddleware
  logger?: NotifyLogger;
}

// Backward-compatibility alias
export type NotifyVariables = PgVariables;

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
