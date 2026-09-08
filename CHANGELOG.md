# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-09-08

### 🚨 BREAKING CHANGES

This is a major release introducing multi-database architecture. Database-dependent symbols have been removed from the root entrypoint (`@bambsdev/notify`).

Consumers must now **explicitly import** from either:
- **`@bambsdev/notify/pg`** for PostgreSQL (Neon / Hyperdrive / node-postgres)
- **`@bambsdev/notify/d1`** for Cloudflare D1 (SQLite)

The root entrypoint (`@bambsdev/notify`) now only exports database-agnostic services, utilities, and shared types (`FCMService`, `WebPushService`, `customLogger`, `logAnalytics`, `fail`, and TypeScript types).

### 📦 Peer Dependencies Update

- `pg` (`>=8.0.0`) is now marked as an **optional peer dependency** (`peerDependenciesMeta.pg.optional = true`).
- If you only use Cloudflare D1 (`@bambsdev/notify/d1`), you no longer need to install `pg` or `@types/pg`.

---

### 🔄 Migration Guide (Upgrading from v1.x to v2.0.0)

#### 1. If You Use PostgreSQL (Neon / Hyperdrive)

Change your import statements from `@bambsdev/notify` to `@bambsdev/notify/pg`:

**Before (v1.x):**
```typescript
import { 
  notifyRoutes, 
  deviceTokenRoutes, 
  dbMiddleware, 
  schema, 
  NotificationService,
  cleanupExpiredNotifications 
} from "@bambsdev/notify";
```

**After (v2.0.0):**
```typescript
import { 
  notifyRoutes, 
  deviceTokenRoutes, 
  dbMiddleware, // or pgMiddleware
  schema, 
  NotificationService,
  cleanupExpiredNotifications 
} from "@bambsdev/notify/pg";
```

#### 2. If You Use Cloudflare D1 (SQLite)

Import everything directly from `@bambsdev/notify/d1`:

```typescript
import { 
  notifyRoutes, 
  deviceTokenRoutes, 
  d1Middleware, // or dbMiddleware
  schema, 
  NotificationService,
  cleanupExpiredNotificationsD1 // or cleanupExpiredNotifications
} from "@bambsdev/notify/d1";
```

#### 3. Drizzle ORM Migrations (`drizzle.config.ts`)

- **PostgreSQL:**
  ```typescript
  import { defineConfig } from "drizzle-kit";

  export default defineConfig({
    schema: [
      "./node_modules/@bambsdev/notify/dist/pg/index.js",
      "./src/db/schema.ts",
    ],
    out: "./drizzle/pg",
    dialect: "postgresql",
    dbCredentials: {
      url: process.env.DATABASE_URL!,
    },
  });
  ```

- **Cloudflare D1 (SQLite):**
  ```typescript
  import { defineConfig } from "drizzle-kit";

  export default defineConfig({
    schema: [
      "./node_modules/@bambsdev/notify/dist/d1/index.js",
      "./src/db/schema.ts",
    ],
    out: "./drizzle/d1",
    dialect: "sqlite",
  });
  ```

#### 4. Scheduled Cron Cleanup

- **PostgreSQL (`@bambsdev/notify/pg`):**
  ```typescript
  import { cleanupExpiredNotifications } from "@bambsdev/notify/pg";

  export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
      ctx.waitUntil(
        cleanupExpiredNotifications(env.HYPERDRIVE.connectionString, {
          deleteExpiredAfterDays: 30,
        })
      );
    },
  };
  ```

- **Cloudflare D1 (`@bambsdev/notify/d1`):**
  ```typescript
  import { cleanupExpiredNotificationsD1 } from "@bambsdev/notify/d1";

  export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
      ctx.waitUntil(
        cleanupExpiredNotificationsD1(env.DB, {
          deleteExpiredAfterDays: 30,
        })
      );
    },
  };
  ```

---

### ✨ What's New & Improvements

- **Full Cloudflare D1 Support:** Complete native SQLite schema (`sqliteTable`) and D1 database client middleware.
- **Dialect-Specific Route Factories:** Routes (`notifyRoutes`, `deviceTokenRoutes`) optimized for each database dialect with zero overhead.
- **Tree-Shaking & Lightweight Bundles:** D1 applications do not pull in any PostgreSQL drivers or types.
- **Universal Date & JSON Handling:** Seamless conversion between PostgreSQL `jsonb` / `timestamptz` and SQLite `text` (JSON mode) / `integer` (timestamp mode).
