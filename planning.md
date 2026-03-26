# Planning: `@bambsdev/notify`

> Drop-in notification module untuk **Hono + Cloudflare Workers + Drizzle ORM** apps.
> Didesain sebagai pasangan dari `@bambsdev/auth` dalam ekosistem SantriKita Group.

---

## 1. Overview & Tujuan

Package ini menyediakan sistem notifikasi lengkap yang bisa langsung di-mount ke project Hono manapun. Mendukung dua jenis notifikasi:

- **FCM Push Notification** — kirim push ke device user via Firebase Cloud Messaging HTTP v1 API
- **In-App Notification** — notifikasi yang disimpan di database dan ditampilkan di dalam aplikasi (feed lonceng)

Package ini **tidak** menangani email transaksional — itu tetap di `@bambsdev/auth`.

---

## 2. Stack & Teknologi

Mengikuti standar yang sama persis dengan `@bambsdev/auth`:

| Komponen      | Teknologi                                     |
| ------------- | --------------------------------------------- |
| Runtime       | Bun                                           |
| Framework     | Hono                                          |
| ORM           | Drizzle ORM                                   |
| Database      | Neon PostgreSQL via CF Hyperdrive             |
| Cache / State | Cloudflare KV                                 |
| File Storage  | Cloudflare R2 _(tidak digunakan di fase MVP)_ |
| Analytics     | Cloudflare Analytics Engine                   |
| AI            | Cloudflare AI _(tidak digunakan di fase MVP)_ |
| Cron          | Cloudflare Cron Triggers                      |
| Build         | tsup (dual CJS/ESM output)                    |
| Type Check    | TypeScript strict                             |
| Push Provider | Firebase Cloud Messaging HTTP v1 API          |
| API Docs      | `@hono/zod-openapi` + Swagger UI              |

---

## 3. Struktur Direktori Package

```
@bambsdev/notify/
├── src/
│   ├── index.ts                  # Main export barrel
│   ├── types.ts                  # NotifyBindings, NotifyVariables, semua interface publik
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema: deviceTokens, notifications
│   │   └── index.ts              # DB connection helper (sama pola dengan auth)
│   ├── middleware/
│   │   └── db.middleware.ts      # dbMiddleware — inject drizzle instance ke context
│   ├── routes/
│   │   ├── device-token.routes.ts  # Register / delete FCM device token
│   │   └── notification.routes.ts  # CRUD in-app notifications
│   ├── openapi/
│   │   ├── schemas.ts              # Zod schemas dengan .openapi() annotation
│   │   └── routes.ts               # createRoute() definitions untuk semua endpoint
│   ├── services/
│   │   ├── fcm.service.ts        # FCM HTTP v1 API + OAuth2 token management
│   │   └── notification.service.ts # Create, query, mark read in-app notifications
│   └── utils/
│       ├── analytics.ts          # Helper log ke CF Analytics Engine
│       └── logger.ts             # Custom logger (sama pola dengan auth)
├── tests/
│   ├── fcm.service.test.ts
│   └── notification.service.test.ts
├── doc/
│   └── api.md
├── .env-example
├── .gitignore
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

---

## 4. Database Schema (Drizzle)

### File: `src/db/schema.ts`

```typescript
import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * deviceTokens
 * Menyimpan FCM device token per user per device.
 * Satu user bisa punya banyak token (multi-device).
 */
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    token: text("token").notNull().unique(), // FCM registration token
    platform: text("platform").notNull(), // "android" | "ios" | "web"
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("device_tokens_user_id_idx").on(table.userId),
  }),
);

/**
 * notifications
 * Menyimpan in-app notification per user.
 * FCM push tidak disimpan di sini (fire-and-forget).
 * In-app notification yang juga dikirim via FCM akan punya fcmMessageId.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"), // Opsional: URL gambar untuk rich notification
    // data: payload tambahan untuk deep-link atau action di app
    data: jsonb("data").$type<Record<string, string>>(),
    isRead: boolean("is_read").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    fcmMessageId: text("fcm_message_id"), // Diisi jika notif juga dikirim via FCM
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Notifikasi yang sudah expired tidak akan muncul di feed
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index("notifications_user_id_idx").on(table.userId),
    userUnreadIdx: index("notifications_user_unread_idx").on(
      table.userId,
      table.isRead,
    ),
    createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
  }),
);

export const schema = { deviceTokens, notifications };
```

> **Catatan penting:** `userId` bertipe `text` agar compatible dengan `@bambsdev/auth` yang menggunakan UUID tersimpan sebagai string, serta agar mudah menerima sub-jenis ID saat SSO diimplementasikan.

---

## 5. Types & Bindings

### File: `src/types.ts`

```typescript
import type { DrizzleDb } from "./db/index.js";

/**
 * NotifyBindings — semua binding CF yang dibutuhkan package ini.
 * Consumer app wajib mendefinisikan semua binding ini di wrangler.toml.
 */
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
}

/**
 * NotifyVariables — variabel yang di-inject ke Hono context via middleware.
 */
export interface NotifyVariables {
  db: DrizzleDb;
  userId: string; // Di-inject oleh authMiddleware dari @bambsdev/auth
}

/**
 * SendPushOptions — payload untuk mengirim FCM push notification.
 */
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

/**
 * SendPushResult — hasil pengiriman FCM.
 */
export interface SendPushResult {
  success: boolean;
  messageId?: string;
  failedTokens?: string[]; // Token yang sudah tidak valid, harus dihapus dari DB
  error?: string;
}

/**
 * CreateNotificationOptions — payload untuk membuat in-app notification.
 * Bisa sekaligus trigger FCM push jika withPush: true.
 */
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
```

---

## 6. Services

### 6a. FCMService — `src/services/fcm.service.ts`

FCM HTTP v1 API memerlukan OAuth2 Bearer token dari Google. Token ini berlaku 1 jam, sehingga harus di-cache di KV agar tidak fetch ulang setiap request.

```typescript
/**
 * FCMService
 *
 * Mengelola:
 * 1. OAuth2 token lifecycle — fetch dari Google, cache di KV dengan TTL 55 menit
 * 2. Kirim single push (by token)
 * 3. Kirim multi-push (by array of tokens, menggunakan sendEach secara sequential
 *    karena FCM HTTP v1 tidak support batch natively di Workers)
 * 4. Subscribe/unsubscribe FCM topic (via legacy FCM API — masih valid untuk topic management)
 */
export class FCMService {
  private readonly kv: KVNamespace;
  private readonly projectId: string;
  private readonly serviceAccountKey: ServiceAccountKey;
  private readonly KV_TOKEN_KEY = "fcm:oauth_token";
  private readonly FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
  private readonly FCM_URL: string;

  constructor(kv: KVNamespace, projectId: string, serviceAccountKeyJson: string) {
    this.kv = kv;
    this.projectId = projectId;
    this.serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    this.FCM_URL = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  }

  /**
   * Mendapatkan OAuth2 access token.
   * Urutan:
   * 1. Cek cache KV
   * 2. Jika tidak ada atau expired → generate JWT → exchange ke Google → simpan ke KV
   */
  async getAccessToken(): Promise<string> { ... }

  /**
   * Generate JWT untuk Google OAuth2 service account.
   * Menggunakan Web Crypto API (tersedia di CF Workers).
   * TIDAK menggunakan library eksternal karena CF Workers tidak support Node.js crypto fully.
   */
  private async generateJWT(): Promise<string> { ... }

  /**
   * Exchange JWT ke Google OAuth2 token endpoint.
   */
  private async exchangeJWTForToken(jwt: string): Promise<string> { ... }

  /**
   * Kirim push notification ke satu FCM token.
   * Return: { success, messageId } atau { success: false, error }
   * Jika response 404 (token tidak valid), return { success: false, invalidToken: true }
   */
  async sendToToken(token: string, payload: FCMPayload): Promise<FCMSendResult> { ... }

  /**
   * Kirim push notification ke banyak token sekaligus.
   * Karena FCM v1 tidak support batch, kita loop sendToToken satu-satu.
   * Menggunakan Promise.allSettled agar satu token gagal tidak membatalkan yang lain.
   * Return: { successCount, failedTokens[] }
   */
  async sendToTokens(tokens: string[], payload: FCMPayload): Promise<FCMBatchResult> { ... }

  /**
   * Kirim push notification ke FCM topic.
   * Cocok untuk broadcast pengumuman pesantren ke semua santri.
   */
  async sendToTopic(topic: string, payload: FCMPayload): Promise<FCMSendResult> { ... }
}
```

**Detail implementasi `generateJWT`:**

Google OAuth2 service account JWT menggunakan RS256. Di CF Workers, kita menggunakan `crypto.subtle` dengan `importKey` + `sign`:

```typescript
// Import RSA private key dari service account
const privateKey = await crypto.subtle.importKey(
  "pkcs8",
  pemToArrayBuffer(this.serviceAccountKey.private_key),
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  false,
  ["sign"],
);

// Buat header + payload JWT
const header = { alg: "RS256", typ: "JWT" };
const now = Math.floor(Date.now() / 1000);
const jwtPayload = {
  iss: this.serviceAccountKey.client_email,
  sub: this.serviceAccountKey.client_email,
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
  scope: this.FCM_SCOPE,
};

// Sign
const data = `${base64url(header)}.${base64url(jwtPayload)}`;
const signature = await crypto.subtle.sign(
  "RSASSA-PKCS1-v1_5",
  privateKey,
  encode(data),
);
return `${data}.${base64url(signature)}`;
```

**Helper `pemToArrayBuffer`:** Harus strip `-----BEGIN PRIVATE KEY-----`, decode base64, return ArrayBuffer.

---

### 6b. NotificationService — `src/services/notification.service.ts`

```typescript
export class NotificationService {
  constructor(
    private db: DrizzleDb,
    private fcm: FCMService,
    private analytics: AnalyticsEngineDataset
  ) {}

  /**
   * Buat in-app notification.
   * Jika options.withPush = true, otomatis fetch semua device token user
   * dan kirim FCM push.
   * Jika ada token yang invalid (404 dari FCM), otomatis hapus dari DB.
   */
  async create(options: CreateNotificationOptions): Promise<typeof notifications.$inferSelect> { ... }

  /**
   * Ambil daftar notifikasi user dengan pagination.
   * Filter: isRead, sebelum expiresAt.
   * Default: 20 item, urut createdAt DESC.
   */
  async list(userId: string, opts?: {
    limit?: number;
    cursor?: string; // UUID dari notifikasi terakhir (cursor-based pagination)
    onlyUnread?: boolean;
  }): Promise<{ items: Notification[]; nextCursor: string | null }> { ... }

  /**
   * Tandai satu notifikasi sebagai sudah dibaca.
   * Validasi: notifikasi harus milik userId yang tepat.
   */
  async markRead(notificationId: string, userId: string): Promise<void> { ... }

  /**
   * Tandai semua notifikasi user sebagai sudah dibaca.
   */
  async markAllRead(userId: string): Promise<{ count: number }> { ... }

  /**
   * Hitung jumlah notifikasi yang belum dibaca.
   * Digunakan untuk badge counter di UI.
   */
  async unreadCount(userId: string): Promise<number> { ... }

  /**
   * Hapus notifikasi yang sudah expired atau lebih tua dari N hari.
   * Dipanggil oleh cron job harian.
   */
  async deleteExpired(olderThanDays?: number): Promise<{ deleted: number }> { ... }

  /**
   * Hapus device token yang sudah tidak valid dari DB.
   * Dipanggil setelah FCMService return failedTokens.
   */
  async pruneInvalidTokens(tokens: string[]): Promise<void> { ... }
}
```

---

## 7. Routes

### 7a. Device Token Routes — `src/routes/device-token.routes.ts`

| Method   | Path                   | Auth | Deskripsi                           |
| -------- | ---------------------- | ---- | ----------------------------------- |
| `POST`   | `/notify/device-token` | 🔒   | Register FCM token baru             |
| `DELETE` | `/notify/device-token` | 🔒   | Hapus FCM token (saat logout)       |
| `GET`    | `/notify/device-token` | 🔒   | List semua token aktif user (debug) |

**POST `/notify/device-token` — Request Body:**

```typescript
{
  token: string; // FCM registration token dari Firebase SDK
  platform: "android" | "ios" | "web";
}
```

**Logic register token:**

1. Validasi body dengan Zod
2. Ambil `userId` dari `c.get("userId")` (di-set oleh `authMiddleware` dari `@bambsdev/auth`)
3. Cek apakah token sudah ada di DB (by `token` field yang unique)
4. Jika sudah ada: update `lastUsedAt` dan `userId` (case: user login di device yang sebelumnya dipakai orang lain)
5. Jika belum: insert baru
6. Log ke Analytics Engine

**DELETE `/notify/device-token` — Request Body:**

```typescript
{
  token: string; // Token yang akan dihapus
}
```

**Logic:**

1. Validasi `token` dengan Zod
2. Pastikan token memang milik `userId` yang sedang login sebelum dihapus
3. Hapus dari DB

---

### 7b. Notification Routes — `src/routes/notification.routes.ts`

| Method | Path                                 | Auth | Deskripsi                             |
| ------ | ------------------------------------ | ---- | ------------------------------------- |
| `GET`  | `/notify/notifications`              | 🔒   | List in-app notifications (paginated) |
| `GET`  | `/notify/notifications/unread-count` | 🔒   | Ambil jumlah belum dibaca             |
| `PUT`  | `/notify/notifications/:id/read`     | 🔒   | Tandai satu notifikasi sudah dibaca   |
| `PUT`  | `/notify/notifications/read-all`     | 🔒   | Tandai semua sudah dibaca             |

**GET `/notify/notifications` — Query Params:**

```
limit: number (optional, default: 20, max: 50)
cursor: string (optional, UUID dari item terakhir)
onlyUnread: boolean (optional, default: false)
```

**Response format (standar):**

```typescript
{
  success: true,
  data: {
    items: Notification[];
    nextCursor: string | null; // null jika sudah halaman terakhir
    hasMore: boolean;
  }
}
```

---

## 8. Middleware

### `src/middleware/db.middleware.ts`

Sama persis dengan pola di `@bambsdev/auth`:

```typescript
import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/pg";
import { Pool } from "pg";
import * as schema from "../db/schema.js";
import type { NotifyBindings, NotifyVariables } from "../types.js";

export const dbMiddleware = createMiddleware<{
  Bindings: NotifyBindings;
  Variables: NotifyVariables;
}>(async (c, next) => {
  const pool = new Pool({
    connectionString: c.env.HYPERDRIVE.connectionString,
  });
  const db = drizzle(pool, { schema });
  c.set("db", db);
  await next();
  await pool.end();
});
```

> **Penting:** Pool harus di-`end()` setelah request selesai untuk mengembalikan koneksi ke Hyperdrive pool.

---

## 9. Main Export — `src/index.ts`

```typescript
// Routes
export { notifyRoutes } from "./routes/notification.routes.js";
export { deviceTokenRoutes } from "./routes/device-token.routes.js";

// Middleware
export { dbMiddleware } from "./middleware/db.middleware.js";

// Services (reusable untuk consumer app)
export { FCMService } from "./services/fcm.service.js";
export { NotificationService } from "./services/notification.service.js";

// Schema (untuk Drizzle migration di consumer app)
export { deviceTokens, notifications, schema } from "./db/schema.js";

// Types
export type {
  NotifyBindings,
  NotifyVariables,
  SendPushOptions,
  SendPushResult,
  CreateNotificationOptions,
} from "./types.js";

// Utils (opsional, jika consumer butuh)
export { customLogger } from "./utils/logger.js";
```

---

## 10. Cron Jobs (Cleanup)

Sama dengan pola di `@bambsdev/auth`, package ini meng-export fungsi utilitas untuk cleanup:

```typescript
// Diekspor dari src/index.ts
export { cleanupExpiredNotifications } from "./services/notification.service.js";
```

Consumer app menambahkan ke `src/index.ts`-nya:

```typescript
import { cleanupExpiredNotifications } from "@bambsdev/notify";

export default {
  async fetch(req, env, ctx) { ... },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 2 * * *") { // Setiap hari jam 02:00 UTC
      ctx.waitUntil(cleanupExpiredNotifications(env.HYPERDRIVE.connectionString, {
        deleteExpiredAfterDays: 30, // Hapus notif > 30 hari
      }));
    }
  }
};
```

---

## 11. Cara Pakai di Consumer App (Quick Start)

### Install

```bash
bun add @bambsdev/notify
```

### Peer Dependencies

```bash
bun add hono drizzle-orm pg zod
```

### Mount ke Hono App

```typescript
// src/index.ts
import { Hono } from "hono";
import {
  authRoutes,
  settingRoutes,
  dbMiddleware as authDb,
  authMiddleware,
} from "@bambsdev/auth";
import {
  notifyRoutes,
  deviceTokenRoutes,
  dbMiddleware as notifyDb,
} from "@bambsdev/notify";
import type { AuthBindings, AuthVariables } from "@bambsdev/auth";
import type { NotifyBindings, NotifyVariables } from "@bambsdev/notify";

type Bindings = AuthBindings & NotifyBindings;
type Variables = AuthVariables & NotifyVariables;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Auth routes
app.use("/auth/*", authDb);
app.route("/auth", authRoutes);

// Notify routes — semua endpoint butuh auth
app.use("/notify/*", notifyDb);
app.use("/notify/*", authMiddleware); // dari @bambsdev/auth
app.route("/notify", notifyRoutes);
app.route("/notify", deviceTokenRoutes);

export default app;
```

> **Catatan:** `authMiddleware` dari `@bambsdev/auth` harus dipasang sebelum notify routes karena semua endpoint notify membutuhkan `c.get("userId")`.

---

## 12. Wrangler Bindings

```toml
# wrangler.toml (di consumer app)
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[vars]
FCM_PROJECT_ID = "your-firebase-project-id"

# Secrets (set via `wrangler secret put`)
# FCM_SERVICE_ACCOUNT_KEY  ← JSON string dari Google service account

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id"

[[kv_namespaces]]
binding = "KV"
id = "your-kv-id"

[[analytics_engine_datasets]]
binding = "ANALYTICS"

[triggers]
crons = ["0 2 * * *"]
```

### Secrets Setup

```bash
wrangler secret put FCM_SERVICE_ACCOUNT_KEY
# Paste seluruh isi JSON service account saat diminta
```

---

## 13. Database Migration di Consumer App

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./node_modules/@bambsdev/auth/dist/index.js",
    "./node_modules/@bambsdev/notify/dist/index.js",
    "./src/db/schema.ts", // schema khusus app
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## 14. Analytics Engine Logging

Setiap event penting dicatat ke CF Analytics Engine untuk observability:

| Event                     | Blobs               | Doubles                   |
| ------------------------- | ------------------- | ------------------------- |
| `device_token_registered` | userId, platform    | —                         |
| `device_token_deleted`    | userId              | —                         |
| `push_sent`               | userId, topic/token | 1 (success) atau 0 (fail) |
| `push_failed`             | userId, error       | failedTokenCount          |
| `notification_created`    | userId              | —                         |
| `notification_read`       | userId              | —                         |
| `notifications_read_all`  | userId              | count                     |
| `cleanup_expired`         | —                   | deletedCount              |

---

## 15. Error Handling Convention

Semua route menggunakan format response yang konsisten:

**Success:**

```typescript
{ success: true, data: { ... } }
{ success: true, message: "..." }
```

**Error:**

```typescript
// 400 Bad Request
{ success: false, error: "VALIDATION_ERROR", message: "token is required" }

// 401 Unauthorized
{ success: false, error: "UNAUTHORIZED" }

// 403 Forbidden
{ success: false, error: "FORBIDDEN", message: "Notification does not belong to this user" }

// 404 Not Found
{ success: false, error: "NOT_FOUND" }

// 500 Internal Server Error
{ success: false, error: "INTERNAL_ERROR" }
```

---

## 16. OpenAPI & Validasi Schema

Package ini menggunakan `@hono/zod-openapi` yang menggabungkan validasi Zod dan dokumentasi OpenAPI dalam satu definisi. Schema didefinisikan **sekali** di `src/openapi/schemas.ts`, lalu dipakai di routes sekaligus sebagai spec.

### ⚠️ CRITICAL: `defaultHook` Wajib Dikonfigurasi

**Jangan pernah** menggunakan `new OpenAPIHono()` tanpa `defaultHook`. Default error dari `@hono/zod-openapi` adalah array Zod issues yang **tidak kompatibel** dengan format error response package ini. `defaultHook` wajib dipasang di setiap `OpenAPIHono` instance agar format error tetap konsisten:

```typescript
// src/routes/device-token.routes.ts
// src/routes/notification.routes.ts
// — WAJIB digunakan di semua file route —

import { OpenAPIHono } from "@hono/zod-openapi";
import type { NotifyBindings, NotifyVariables } from "../types.js";

const app = new OpenAPIHono<{
  Bindings: NotifyBindings;
  Variables: NotifyVariables;
}>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: "VALIDATION_ERROR",
          message: result.error.issues[0]?.message || "Input tidak valid",
        },
        400,
      );
    }
  },
});
```

### File: `src/openapi/schemas.ts`

> Import `z` dari `@hono/zod-openapi`, **bukan** dari `zod` langsung. Jangan ubah aturan validasi yang sudah ada, cukup tambahkan `.openapi({ example: "..." })`.

```typescript
import { z } from "@hono/zod-openapi";

// ── Request Schemas ──────────────────────────────────────────────

export const RegisterDeviceTokenBodySchema = z
  .object({
    token: z
      .string()
      .min(1, "token wajib diisi")
      .openapi({ example: "fMq3R...xyz" }),
    platform: z.enum(["android", "ios", "web"]).openapi({ example: "android" }),
  })
  .openapi("RegisterDeviceTokenBody");

export const DeleteDeviceTokenBodySchema = z
  .object({
    token: z
      .string()
      .min(1, "token wajib diisi")
      .openapi({ example: "fMq3R...xyz" }),
  })
  .openapi("DeleteDeviceTokenBody");

export const ListNotificationsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .min(1)
      .max(50)
      .default(20)
      .openapi({ example: 20 }),
    cursor: z
      .string()
      .uuid()
      .optional()
      .openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    onlyUnread: z.coerce.boolean().default(false).openapi({ example: false }),
  })
  .openapi("ListNotificationsQuery");

// ── Response Schemas ─────────────────────────────────────────────

export const NotificationSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string(),
    title: z.string(),
    body: z.string(),
    imageUrl: z.string().nullable(),
    data: z.record(z.string()).nullable(),
    isRead: z.boolean(),
    readAt: z.string().datetime().nullable(),
    fcmMessageId: z.string().nullable(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  })
  .openapi("Notification");

export const DeviceTokenSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string(),
    token: z.string(),
    platform: z.enum(["android", "ios", "web"]),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime(),
  })
  .openapi("DeviceToken");

export const PaginatedNotificationsSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      items: z.array(NotificationSchema),
      nextCursor: z.string().uuid().nullable(),
      hasMore: z.boolean(),
    }),
  })
  .openapi("PaginatedNotifications");

export const UnreadCountSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ count: z.number() }),
  })
  .openapi("UnreadCount");

export const ErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.string().openapi({ example: "VALIDATION_ERROR" }),
    message: z.string().optional().openapi({ example: "token wajib diisi" }),
  })
  .openapi("ErrorResponse");
```

### File: `src/openapi/routes.ts`

```typescript
import { createRoute, z } from "@hono/zod-openapi";
import {
  RegisterDeviceTokenBodySchema,
  DeleteDeviceTokenBodySchema,
  ListNotificationsQuerySchema,
  PaginatedNotificationsSchema,
  UnreadCountSchema,
  DeviceTokenSchema,
  ErrorSchema,
} from "./schemas.js";

const bearerAuth = [{ bearerAuth: [] }];
const commonErrors = {
  401: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Unauthorized",
  },
  500: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Internal Server Error",
  },
};

export const registerDeviceTokenRoute = createRoute({
  method: "post",
  path: "/notify/device-token",
  tags: ["Device Token"],
  summary: "Register FCM device token",
  description:
    "Daftarkan token setelah login atau saat Firebase SDK memberikan token baru.",
  security: bearerAuth,
  request: {
    body: {
      content: {
        "application/json": { schema: RegisterDeviceTokenBodySchema },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: DeviceTokenSchema } },
      description: "Token terdaftar",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Validation Error",
    },
    ...commonErrors,
  },
});

export const deleteDeviceTokenRoute = createRoute({
  method: "delete",
  path: "/notify/device-token",
  tags: ["Device Token"],
  summary: "Hapus FCM device token",
  description: "Hapus token saat user logout.",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: DeleteDeviceTokenBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ success: z.literal(true) }) },
      },
      description: "Token dihapus",
    },
    403: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Token bukan milik user ini",
    },
    ...commonErrors,
  },
});

export const listNotificationsRoute = createRoute({
  method: "get",
  path: "/notify/notifications",
  tags: ["Notifications"],
  summary: "List in-app notifications",
  description: "Cursor-based pagination. Urutkan createdAt DESC.",
  security: bearerAuth,
  request: { query: ListNotificationsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: PaginatedNotificationsSchema } },
      description: "Daftar notifikasi",
    },
    ...commonErrors,
  },
});

export const unreadCountRoute = createRoute({
  method: "get",
  path: "/notify/notifications/unread-count",
  tags: ["Notifications"],
  summary: "Jumlah notifikasi belum dibaca",
  description: "Untuk badge counter di ikon lonceng.",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: UnreadCountSchema } },
      description: "Unread count",
    },
    ...commonErrors,
  },
});

export const markReadRoute = createRoute({
  method: "put",
  path: "/notify/notifications/{id}/read",
  tags: ["Notifications"],
  summary: "Tandai satu notifikasi sudah dibaca",
  security: bearerAuth,
  request: {
    params: z.object({
      id: z
        .string()
        .uuid()
        .openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ success: z.literal(true) }) },
      },
      description: "Berhasil",
    },
    403: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Bukan milik user ini",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Tidak ditemukan",
    },
    ...commonErrors,
  },
});

export const markAllReadRoute = createRoute({
  method: "put",
  path: "/notify/notifications/read-all",
  tags: ["Notifications"],
  summary: "Tandai semua notifikasi sudah dibaca",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ count: z.number() }),
          }),
        },
      },
      description: "Berhasil",
    },
    ...commonErrors,
  },
});
```

### Penggunaan di Handler

```typescript
// src/routes/notification.routes.ts
app.openapi(listNotificationsRoute, async (c) => {
  const { limit, cursor, onlyUnread } = c.req.valid("query"); // sudah tervalidasi Zod
  const userId = c.get("userId");
  // ... business logic
  return c.json({ success: true as const, data: result });
});
```

### Swagger UI di Consumer App

Consumer app (bukan di packagenya) menambahkan endpoint `/doc` di `src/index.ts`-nya:

```typescript
import { swaggerUI } from "@hono/swagger-ui";

// Expose OpenAPI JSON spec
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { title: "My App API", version: "1.0.0" },
});

// Swagger UI
app.get("/doc", swaggerUI({ url: "/openapi.json" }));
```

---

## 17. package.json

```json
{
  "name": "@bambsdev/notify",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      },
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "prepublishOnly": "bun run build"
  },
  "publishConfig": {
    "access": "public"
  },
  "peerDependencies": {
    "@hono/zod-openapi": ">=0.16.0",
    "drizzle-orm": ">=0.36.0",
    "hono": ">=4.0.0",
    "pg": ">=8.0.0",
    "zod": ">=4.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260301.1",
    "@hono/swagger-ui": "^0.5.0",
    "@hono/zod-openapi": "^0.16.0",
    "@types/bun": "latest",
    "@types/pg": "^8.18.0",
    "drizzle-orm": "^0.45.1",
    "hono": "^4.12.7",
    "pg": "^8.19.0",
    "tsup": "^8.0.0",
    "typescript": "^5.9.3",
    "zod": "^4.3.6"
  }
}
```

---

## 18. tsup.config.ts

Sama persis dengan `@bambsdev/auth`:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ["hono", "@hono/zod-openapi", "drizzle-orm", "pg", "zod"],
});
```

---

## 19. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## 20. Catatan Penting untuk Implementasi

### OpenAPI Implementation Guardrails

Berikut adalah aturan yang **wajib diikuti** saat mengimplementasikan OpenAPI, berdasarkan pola yang sama dengan `@bambsdev/auth`:

**1. `defaultHook` di setiap `OpenAPIHono` instance**
Jangan pernah instantiate `new OpenAPIHono()` tanpa `defaultHook`. Default error Zod akan merusak format response. Lihat detail di Section 16.

**2. Import `z` dari `@hono/zod-openapi`, bukan dari `zod`**

```typescript
// ✅ Benar
import { z } from "@hono/zod-openapi";

// ❌ Salah — tidak akan menghasilkan OpenAPI spec
import { z } from "zod";
```

**3. Jangan ubah aturan validasi saat menambah `.openapi()`**
Cukup append `.openapi({ example: "..." })` ke schema yang sudah ada. Jangan sentuh `.min()`, `.max()`, `.email()`, dsb.

**4. Implementasi satu route, test, baru lanjut**
Jangan migrasi semua route sekaligus. Setelah setiap route selesai, jalankan `bun test` dan pastikan format error response tetap `{ success: false, error: "...", message: "..." }`. Jika test gagal, rollback dan fix sebelum lanjut.

**5. `c.req.valid()` menggantikan `parseBody()`**

```typescript
// ✅ Setelah migrasi ke openapi
const { token, platform } = c.req.valid("json");
const { limit, cursor } = c.req.valid("query");
const { id } = c.req.valid("param");
```

---

### FCM OAuth2 di CF Workers

CF Workers **tidak mendukung** `google-auth-library` atau `googleapis` SDK karena mereka bergantung pada Node.js built-ins yang tidak tersedia. Implementasi JWT OAuth2 **wajib menggunakan `crypto.subtle`** dari Web Crypto API.

**Flow lengkap FCM OAuth2:**

```
1. Baca FCM_SERVICE_ACCOUNT_KEY dari env (JSON string)
2. Cek KV: ada cached token? → pakai langsung
3. Generate JWT menggunakan crypto.subtle (RS256)
4. POST ke https://oauth2.googleapis.com/token
5. Simpan access_token ke KV dengan TTL = 55 menit (token valid 60 menit, margin 5 menit)
6. Gunakan access_token sebagai Authorization: Bearer header di FCM request
```

### Multi-Token Send Strategy

FCM v1 API tidak mendukung batch send. Untuk kirim ke banyak device sekaligus:

- Gunakan `Promise.allSettled` agar partial failure tidak membatalkan semua
- Token yang return 404 dari FCM → segera hapus dari `deviceTokens` table (token sudah expired/invalid)
- Token yang return 500 dari FCM → jangan hapus, coba lagi di request berikutnya

### Keamanan Endpoint `/notify/send`

Endpoint server-to-server untuk mengirim notifikasi (dipanggil oleh backend business logic) **tidak boleh** di-expose ke public. Ada dua opsi:

1. Tidak dibuat sebagai Hono route — cukup sebagai exported `NotificationService.create()` yang dipanggil langsung dari kode consumer
2. Jika butuh HTTP endpoint, harus dilindungi dengan service-to-service secret header

**Rekomendasi: pilih opsi 1.** Consumer app cukup menggunakan `NotificationService` langsung:

```typescript
// Di business logic consumer app
import { NotificationService, FCMService } from "@bambsdev/notify";

const fcm = new FCMService(
  c.env.KV,
  c.env.FCM_PROJECT_ID,
  c.env.FCM_SERVICE_ACCOUNT_KEY,
);
const notifService = new NotificationService(db, fcm, c.env.ANALYTICS);

await notifService.create({
  userId: "user-123",
  title: "Pembayaran SPP",
  body: "Tagihan SPP bulan April telah tersedia.",
  withPush: true,
});
```

---

## 21. Tahapan Implementasi (Urutan Pengerjaan)

1. **Setup project** — `package.json`, `tsconfig.json`, `tsup.config.ts`
2. **Schema Drizzle** — `src/db/schema.ts` + test migration di Neon
3. **Types** — `src/types.ts`
4. **DB Middleware** — `src/middleware/db.middleware.ts`
5. **FCMService** — `src/services/fcm.service.ts` (bagian paling kompleks, test dulu terpisah)
6. **NotificationService** — `src/services/notification.service.ts`
7. **OpenAPI schemas** — `src/openapi/schemas.ts`
8. **OpenAPI route definitions** — `src/openapi/routes.ts`
9. **Device Token Routes** — `src/routes/device-token.routes.ts` (pakai `OpenAPIHono` + `defaultHook`)
10. **Notification Routes** — `src/routes/notification.routes.ts` (pakai `OpenAPIHono` + `defaultHook`)
11. **Main export barrel** — `src/index.ts`
12. **Unit tests** — `tests/` (pastikan format error response konsisten di setiap route)
13. **Build & publish** ke npm

---

_Planning ini dibuat berdasarkan pola dan konvensi yang digunakan di `@bambsdev/auth` v1.0.22._
