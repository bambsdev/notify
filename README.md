# @bambsdev/notify

> Drop-in notification module (FCM Push & In-App Feed) untuk **Hono + Cloudflare Workers + Drizzle ORM**.
> Pasangan dari `@bambsdev/auth` dalam ekosistem SantriKita Group.

---

## 📦 Fitur Utama

- **In-App Notification Feed:** Notifikasi tersimpan di database PostgreSQL (via Drizzle), mendukung cursor-based pagination, status dibaca (*read/unread*), dan *auto-expiration*.
- **FCM Push Notification:** Pengiriman notifikasi ke perangkat (Android, iOS, Web) menggunakan Firebase Cloud Messaging HTTP v1 API.
- **OAuth2 Token Caching:** Otomatis mengambil, memperbarui, dan meng-cache Google OAuth2 token di Cloudflare KV dengan TTL.
- **Edge Runtime Ready:** Optimal dijalankan di lingkungan serverless/edge (seperti Cloudflare Workers) tanpa dependensi Node.js yang berat.
- **Zod OpenAPI Docs:** Skema API terintegrasi penuh dengan `@hono/zod-openapi` untuk dokumentasi otomatis.

---

## 🚀 Instalasi

Tambahkan package ini ke proyek Hono Anda:

```bash
bun add @bambsdev/notify
```

### Peer Dependencies
Pastikan proyek Anda juga memiliki dependensi berikut:

```bash
bun add hono drizzle-orm pg zod @hono/zod-openapi
```

---

## ⚙️ Konfigurasi Cloudflare (wrangler.toml)

Tambahkan binding berikut pada berkas `wrangler.toml` di aplikasi Anda:

```toml
# Kredensial Firebase (isi via wrangler secret / env)
[vars]
FCM_PROJECT_ID = "your-firebase-project-id"

# Hyperdrive untuk koneksi database PostgreSQL
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id"

# KV untuk cache OAuth2 Token FCM
[[kv_namespaces]]
binding = "KV"
id = "your-kv-id"

# Analytics Engine Dataset untuk log event notifikasi
[[analytics_engine_datasets]]
binding = "ANALYTICS"
```

### Setup Secrets
Masukkan Service Account Key Firebase (format JSON) sebagai secret:

```bash
wrangler secret put FCM_SERVICE_ACCOUNT_KEY
```

---

## 🛠️ Integrasi Database (Drizzle ORM)

Ekspor skema dari `@bambsdev/notify` di dalam konfigurasi `drizzle.config.ts` Anda agar migrasi database terbentuk:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./node_modules/@bambsdev/auth/dist/index.js",
    "./node_modules/@bambsdev/notify/dist/index.js",
    "./src/db/schema.ts", // Skema internal aplikasi Anda
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## 🚦 Routing & Mounting ke Hono App

Mount router ke dalam Hono app Anda. Direkomendasikan untuk memasang `authMiddleware` (dari `@bambsdev/auth`) sebelum *routing* notifikasi karena modul ini memerlukan `c.get("userId")`.

```typescript
import { Hono } from "hono";
import { authMiddleware } from "@bambsdev/auth";
import { 
  notifyRoutes, 
  deviceTokenRoutes, 
  dbMiddleware as notifyDb 
} from "@bambsdev/notify";

const app = new Hono();

// Pasang DB middleware & authMiddleware untuk prefix /api/notifications
app.use("/api/notifications/*", notifyDb);
app.use("/api/notifications/*", authMiddleware);

// Mount router notifikasi (tanpa redundant prefix)
app.route("/api/notifications", notifyRoutes);

// Mount router device token (di /api/device-token atau path lain sesuai keinginan)
app.use("/api/device-token/*", notifyDb);
app.use("/api/device-token/*", authMiddleware);
app.route("/api/device-token", deviceTokenRoutes);

export default app;
```

---

## 📌 Daftar API Endpoints

### 1. Device Token (FCM Registration)
Dapatkan atau daftarkan token perangkat untuk push notification.

- **`POST /api/device-token`**
  Mendaftarkan atau memperbarui token perangkat.
  *Body:*
  ```json
  {
    "token": "fMq3R...xyz",
    "platform": "android" 
  }
  ```
- **`DELETE /api/device-token`**
  Menghapus token perangkat saat user logout.
  *Body:*
  ```json
  {
    "token": "fMq3R...xyz"
  }
  ```
- **`GET /api/device-token`**
  Melihat daftar token perangkat yang terdaftar atas user aktif (untuk debug).

### 2. In-App Notifications
Mengelola notifikasi feed milik user.

- **`GET /api/notifications`**
  Mengambil daftar notifikasi terenkapsulasi (paginated).
  *Query Parameters:*
  - `limit`: Jumlah data per halaman (default 20, max 50).
  - `cursor`: ID notifikasi terakhir untuk cursor pagination.
  - `onlyUnread`: `true` jika hanya ingin mengambil notifikasi belum dibaca.
- **`GET /api/notifications/unread-count`**
  Mendapatkan jumlah notifikasi yang belum dibaca (untuk badge counter).
- **`PUT /api/notifications/:id/read`**
  Menandai satu notifikasi tertentu sebagai telah dibaca.
- **`PUT /api/notifications/read-all`**
  Menandai seluruh notifikasi user aktif sebagai telah dibaca.

---

## 🧹 Pembersihan Otomatis (Cron Job)

Anda dapat menjadwalkan tugas harian untuk menghapus notifikasi yang kedaluwarsa:

```typescript
import { cleanupExpiredNotifications } from "@bambsdev/notify";

export default {
  async fetch(req, env, ctx) {
    return app.fetch(req, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (event.cron === "0 2 * * *") { // Setiap hari pukul 02:00 UTC
      ctx.waitUntil(
        cleanupExpiredNotifications(env.HYPERDRIVE.connectionString, {
          deleteExpiredAfterDays: 30, // Hapus notifikasi berumur lebih dari 30 hari
        })
      );
    }
  }
};
```
