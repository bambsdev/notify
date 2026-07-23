# 🔔 @bambsdev/notify

> Enterprise-grade, edge-native notification package (FCM Push, WebPush VAPID, & In-App Feed) for **Hono**, **Cloudflare Workers**, and **Drizzle ORM**.
> Designed for high-performance serverless ecosystems and seamless integration with `@bambsdev/auth`.

[![npm version](https://img.shields.io/npm/v/@bambsdev/notify.svg)](https://www.npmjs.com/package/@bambsdev/notify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9%2B-blue)](https://www.typescriptlang.org/)

---

## 🌟 Key Features

- **📱 Multi-Channel Push Notifications:**
  - **Firebase Cloud Messaging (FCM HTTP v1):** Push notifications to Android, iOS, and Web devices.
  - **Native WebPush (VAPID):** Standard WebPush payload delivery built with Web Crypto API (`ECDSA P-256`, `AES-128-GCM`) tailored for Cloudflare Edge Runtime without heavyweight Node.js dependencies.
- **📥 In-App Notification Feed:** Complete inbox management stored in PostgreSQL with cursor-based pagination, unread counters, bulk read, and configurable auto-expiration.
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

Ensure your project includes the required peer dependencies:

```bash
bun add hono drizzle-orm pg zod @hono/zod-openapi
```

---

## ⚙️ Configuration & Cloudflare Setup (`wrangler.toml`)

Add the required bindings to your consumer project's `wrangler.toml`:

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
# LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/mydb" # Optional local dev fallback

# Hyperdrive for PostgreSQL database connection pooling
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id"

# KV Namespace for FCM OAuth2 token caching
[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"

# Analytics Engine Dataset for audit logs
[[analytics_engine_datasets]]
binding = "ANALYTICS"
```

### Secrets Setup

Set sensitive secrets via `wrangler secret`:

```bash
# Firebase Service Account JSON string
wrangler secret put FCM_SERVICE_ACCOUNT_KEY

# WebPush VAPID Private Key (PKCS#8 Base64URL string)
wrangler secret put VAPID_PRIVATE_KEY
```

---

## 🛠️ Database Integration (Drizzle ORM)

Export the `@bambsdev/notify` schema inside your project's `drizzle.config.ts` so Drizzle Kit includes the notification tables during migrations:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./node_modules/@bambsdev/auth/dist/index.js",
    "./node_modules/@bambsdev/notify/dist/index.js",
    "./src/db/schema.ts", // Your application schemas
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## 🚦 Routing & Mounting in Hono

Mount `@bambsdev/notify` OpenAPI routes in your Hono application.

> ℹ️ **Note:** Ensure `authMiddleware` (from `@bambsdev/auth`) or your custom auth middleware runs before notification routes to set `c.set("userId", userId)`.

```typescript
import { Hono } from "hono";
import { authMiddleware } from "@bambsdev/auth";
import { 
  notifyRoutes, 
  deviceTokenRoutes, 
  dbMiddleware as notifyDb 
} from "@bambsdev/notify";

const app = new Hono<{ Bindings: Env }>();

// 1. Device Token Routes (/api/device-token)
app.use("/api/device-token/*", notifyDb);
app.use("/api/device-token/*", authMiddleware);
app.route("/api/device-token", deviceTokenRoutes);

// 2. Notification Feed Routes (/api/notifications)
app.use("/api/notifications/*", notifyDb);
app.use("/api/notifications/*", authMiddleware);
app.route("/api/notifications", notifyRoutes);

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
    - `cursor` *(optional)*: ID of the last item from previous page for cursor pagination.
    - `onlyUnread` *(optional)*: Pass `"true"` to filter unread notifications only.
- **`GET /api/notifications/unread-count`**
  Get total count of unread notifications for badge counts.
  ```json
  {
    "success": true,
    "data": {
      "unreadCount": 5
    }
  }
  ```
- **`PUT /api/notifications/:id/read`**
  Mark a single notification as read by ID.
- **`PUT /api/notifications/read-all`**
  Mark all notifications of the authenticated user as read.

---

## 💡 Programmatic Usage & Services

You can import and use core notification services directly in your backend routes or queue workers:

### Sending Push Notifications (`NotificationService`)

```typescript
import { NotificationService } from "@bambsdev/notify";

// Create in-app feed entry and optionally trigger FCM / WebPush push notification
const notification = await NotificationService.createNotification(db, env, {
  userId: "usr_123456",
  title: "New Order Received!",
  body: "Order #9876 has been paid successfully.",
  imageUrl: "https://example.com/assets/order.png",
  data: {
    orderId: "9876",
    action: "open_order_details"
  },
  withPush: true, // Automatically sends FCM & WebPush to user's registered devices
});
```

### Direct Push Messaging (`FCMService` & `WebPushService`)

```typescript
import { FCMService, WebPushService } from "@bambsdev/notify";

// Direct FCM message
const fcm = new FCMService(env);
await fcm.sendToUser(db, "usr_123456", {
  title: "Special Discount",
  body: "Get 20% off today!",
});

// Direct WebPush payload delivery via VAPID
const webpush = new WebPushService(env);
await webpush.sendNotification(
  {
    endpoint: "https://updates.push.services.mozilla.com/wpush/v2/...",
    keys: {
      p256dh: "BEl...",
      auth: "5EK..."
    }
  },
  JSON.stringify({ title: "Web Notification", body: "Hello WebPush!" })
);
```

---

## 🧹 Automated Cleanup (Cron Job)

Schedule daily execution to automatically drop expired notifications and maintain optimal database size:

```typescript
import { cleanupExpiredNotifications } from "@bambsdev/notify";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(req, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 2 * * *") { // Daily at 02:00 UTC
      ctx.waitUntil(
        cleanupExpiredNotifications(env.HYPERDRIVE.connectionString, {
          deleteExpiredAfterDays: 30, // Deletes read/expired notifications older than 30 days
        })
      );
    }
  }
};
```

---

## 📄 License

[MIT License](LICENSE) © BambsDev / SantriKita Group

