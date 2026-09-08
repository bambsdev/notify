# 🔔 @bambsdev/notify

> Enterprise-grade, edge-native notification package (FCM Push, WebPush VAPID, & In-App Feed) for **Hono**, **Cloudflare Workers**, and **Drizzle ORM**.
> Supports **PostgreSQL (Neon / Hyperdrive)** and **Cloudflare D1 (SQLite)**.
> Designed for high-performance serverless ecosystems and seamless integration with `@bambsdev/auth`.

[![npm version](https://img.shields.io/npm/v/@bambsdev/notify.svg)](https://www.npmjs.com/package/@bambsdev/notify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9%2B-blue)](https://www.typescriptlang.org/)

---

## 🌟 Key Features

- **🗄️ Multi-Database Architecture:**
  - Explicit imports: **`@bambsdev/notify/pg`** for PostgreSQL and **`@bambsdev/notify/d1`** for Cloudflare D1.
  - No unnecessary drivers bundled (e.g. `pg` is optional when using D1).
- **📱 Multi-Channel Push Notifications:**
  - **Firebase Cloud Messaging (FCM HTTP v1):** Push notifications to Android, iOS, and Web devices.
  - **Native WebPush (VAPID):** Standard WebPush payload delivery built with Web Crypto API (`ECDSA P-256`, `AES-128-GCM`) tailored for Cloudflare Edge Runtime without heavyweight Node.js dependencies.
- **📥 In-App Notification Feed:** Complete inbox management stored in your database (PostgreSQL or D1) with cursor-based pagination, unread counters, bulk read, and configurable auto-expiration.
- **🔑 Automated FCM OAuth2 Token Lifecycle:** Automatic OAuth2 token retrieval and caching using Cloudflare KV with TTL management.
- **📊 Real-time Edge Analytics:** Direct integration with Cloudflare Analytics Engine dataset for auditing delivery logs, registration metrics, and latency analysis.
- **📐 OpenAPI / Swagger Ready:** Fully typed OpenAPI routes powered by `@hono/zod-openapi` for instant Swagger UI generation.
- **⚡ Edge Native Performance:** Optimized for serverless environments (Cloudflare Workers, Cloudflare Pages, Bun).

---

## 📦 Installation

Install the package via Bun (or npm/pnpm/yarn):

```bash
bun add @bambsdev/notify
```

### Peer Dependencies

Install the appropriate peer dependencies based on your database stack:

**For PostgreSQL (Neon / Hyperdrive):**
```bash
bun add hono drizzle-orm pg zod @hono/zod-openapi
```

**For Cloudflare D1 (SQLite):**
```bash
bun add hono drizzle-orm zod @hono/zod-openapi
# Note: 'pg' is optional and NOT required for D1!
```

---

## ⚙️ Configuration & Cloudflare Setup (`wrangler.toml`)

Add the required bindings to your consumer project's `wrangler.toml`:

### 1. Common Bindings & Variables (Both PG and D1)

```toml
name = "my-hono-app"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

# Environment Variables & WebPush VAPID Keys
[vars]
FCM_PROJECT_ID = "your-firebase-project-id"
VAPID_PUBLIC_KEY = "your-vapid-public-key-p256"
VAPID_SUBJECT = "mailto:admin@example.com"

# KV Namespace for FCM OAuth2 token caching
[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"

# Analytics Engine Dataset for audit logs
[[analytics_engine_datasets]]
binding = "ANALYTICS"
```

### 2. Database Binding

#### Option A: PostgreSQL via Hyperdrive (`@bambsdev/notify/pg`)

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id"

# Optional local dev fallback in [vars]:
# LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/mydb"
```

#### Option B: Cloudflare D1 (`@bambsdev/notify/d1`)

```toml
[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "your-d1-database-id"
```

---

### 🔑 Generating VAPID Keys

Consumer apps can generate a new ECDSA P-256 VAPID keypair directly from `node_modules` using the bundled CLI tool:

```bash
bunx notify-keys
# or
npx notify-keys
```

### Secrets Setup

Set sensitive secrets via `wrangler secret`:

```bash
# Firebase Service Account JSON string
wrangler secret put FCM_SERVICE_ACCOUNT_KEY

# WebPush VAPID Private Key
wrangler secret put VAPID_PRIVATE_KEY
```

---

## 🛠️ Database Integration (Drizzle ORM)

Export the schema inside your project's `drizzle.config.ts` so Drizzle Kit includes the notification tables during migrations:

### PostgreSQL (`drizzle.config.ts`):
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./node_modules/@bambsdev/notify/dist/pg/index.js",
    "./src/db/schema.ts", // Your application schemas
  ],
  out: "./drizzle/pg",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Cloudflare D1 (`drizzle.config.ts`):
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./node_modules/@bambsdev/notify/dist/d1/index.js",
    "./src/db/schema.ts", // Your application schemas
  ],
  out: "./drizzle/d1",
  dialect: "sqlite",
});
```

---

## 🚦 Routing & Mounting in Hono

### 1. Using PostgreSQL (`@bambsdev/notify/pg`)

```typescript
import { Hono } from "hono";
import { authMiddleware } from "@bambsdev/auth/pg";
import { 
  notifyRoutes, 
  deviceTokenRoutes, 
  dbMiddleware as notifyDb,
  type PgBindings as Env
} from "@bambsdev/notify/pg";

const app = new Hono<{ Bindings: Env }>();

// 1. Device Token Routes (/api/device-token)
app.use("/api/device-token/*", notifyDb);
app.use("/api/device-token/*", authMiddleware);
app.route("/api", deviceTokenRoutes);

// 2. Notification Feed Routes (/api/notifications)
app.use("/api/notifications/*", notifyDb);
app.use("/api/notifications/*", authMiddleware);
app.route("/api", notifyRoutes);

export default app;
```

### 2. Using Cloudflare D1 (`@bambsdev/notify/d1`)

```typescript
import { Hono } from "hono";
import { authMiddleware } from "@bambsdev/auth/d1";
import { 
  notifyRoutes, 
  deviceTokenRoutes, 
  d1Middleware as notifyDb,
  type D1Bindings as Env
} from "@bambsdev/notify/d1";

const app = new Hono<{ Bindings: Env }>();

// 1. Device Token Routes (/api/device-token)
app.use("/api/device-token/*", notifyDb);
app.use("/api/device-token/*", authMiddleware);
app.route("/api", deviceTokenRoutes);

// 2. Notification Feed Routes (/api/notifications)
app.use("/api/notifications/*", notifyDb);
app.use("/api/notifications/*", authMiddleware);
app.route("/api", notifyRoutes);

export default app;
```

---

## 📌 API Reference

### 1. Device Token & WebPush Subscription Management

- **`POST /api/device-token`**
  Register or update a device push token or WebPush subscription for the active user.
  - **FCM Token Request:**
    ```json
    {
      "token": "fMq3R...xyz",
      "platform": "android"
    }
    ```
    *Platforms:* `android` | `ios` | `web`
  - **WebPush Subscription Request:**
    ```json
    {
      "token": "https://fcm.googleapis.com/fcm/send/ebX...",
      "platform": "webpush",
      "provider": "webpush",
      "keys": {
        "p256dh": "BNc...=",
        "auth": "tBC...="
      }
    }
    ```
- **`DELETE /api/device-token`**
  Remove a device token or subscription (e.g. upon user logout).
  ```json
  {
    "token": "fMq3R...xyz"
  }
  ```
- **`GET /api/device-token`**
  Fetch all registered tokens/subscriptions belonging to the authenticated user.

---

### 2. In-App Notification Feed

- **`GET /api/notifications`**
  Retrieve paginated in-app notification feed.
  - **Query Parameters:**
    - `limit` *(optional)*: Number of items per page (default: `20`, max: `50`).
    - `cursor` *(optional)*: UUID of the last item from previous page for cursor pagination.
    - `onlyUnread` *(optional)*: Pass `true` to filter unread notifications only.
- **`GET /api/notifications/unread-count`**
  Get total count of unread notifications for badge counters.
- **`PUT /api/notifications/:id/read`**
  Mark a single notification as read by ID.
- **`PUT /api/notifications/read-all`**
  Mark all notifications of the authenticated user as read.

---

## 💡 Programmatic Usage & Services

### In-App Feed & Push (`NotificationService`)

```typescript
// For PostgreSQL:
import { NotificationService } from "@bambsdev/notify/pg";
// For D1:
// import { NotificationService } from "@bambsdev/notify/d1";

const svc = new NotificationService(db, fcm, env.ANALYTICS, webPush);

// Create in-app feed entry and optionally trigger FCM / WebPush push notification
const notification = await svc.create({
  userId: "usr_123456",
  title: "New Order Received!",
  body: "Order #9876 has been paid successfully.",
  imageUrl: "https://example.com/assets/order.png",
  data: {
    orderId: "9876",
    action: "open_order_details"
  },
  withPush: true, // Automatically sends push to user's registered devices
});
```

### Direct Push Messaging (`FCMService` & `WebPushService`)

Shared across all database stacks:

```typescript
import { FCMService, WebPushService } from "@bambsdev/notify";

// Direct FCM message
const fcm = new FCMService(env.KV, env.FCM_PROJECT_ID, env.FCM_SERVICE_ACCOUNT_KEY);
await fcm.sendToTokens(["device-token-1"], {
  title: "Special Discount",
  body: "Get 20% off today!",
});

// Direct WebPush payload delivery via VAPID
const webpush = new WebPushService(
  env.VAPID_PUBLIC_KEY, 
  env.VAPID_PRIVATE_KEY, 
  env.VAPID_SUBJECT
);
await webpush.sendNotification(
  {
    endpoint: "https://updates.push.services.mozilla.com/wpush/v2/...",
    keys: {
      p256dh: "BEl...",
      auth: "5EK..."
    }
  },
  { title: "Web Notification", body: "Hello WebPush!" }
);
```

---

## 🧹 Automated Cleanup (Cron Job)

Schedule daily execution to automatically drop expired notifications:

### PostgreSQL (`@bambsdev/notify/pg`)
```typescript
import { cleanupExpiredNotifications } from "@bambsdev/notify/pg";

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 2 * * *") {
      ctx.waitUntil(
        cleanupExpiredNotifications(env.HYPERDRIVE.connectionString, {
          deleteExpiredAfterDays: 30,
        })
      );
    }
  }
};
```

### Cloudflare D1 (`@bambsdev/notify/d1`)
```typescript
import { cleanupExpiredNotificationsD1 } from "@bambsdev/notify/d1";

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 2 * * *") {
      ctx.waitUntil(
        cleanupExpiredNotificationsD1(env.DB, {
          deleteExpiredAfterDays: 30,
        })
      );
    }
  }
};
```

---

## 📄 License

[MIT License](LICENSE) © BambsDev / SantriKita Group
