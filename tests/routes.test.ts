import { describe, test, expect, mock } from "bun:test";
import { Hono } from "hono";
import { deviceTokenRoutes as pgDeviceTokenRoutes, notifyRoutes as pgNotifyRoutes } from "../src/pg";
import { deviceTokenRoutes as d1DeviceTokenRoutes, notifyRoutes as d1NotifyRoutes } from "../src/d1";

describe("Route Integration: @bambsdev/notify/pg and @bambsdev/notify/d1", () => {
  test("PG routes handle validation error properly", async () => {
    const app = new Hono();
    app.route("/", pgDeviceTokenRoutes);

    // POST without body / invalid json
    const res = await app.request("/device-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("D1 routes handle validation error properly", async () => {
    const app = new Hono();
    app.route("/", d1DeviceTokenRoutes);

    const res = await app.request("/device-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("PG notification routes return 401 when userId is missing", async () => {
    const app = new Hono();
    app.route("/notifications", pgNotifyRoutes);

    const res = await app.request("/notifications");
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("D1 notification routes return 401 when userId is missing", async () => {
    const app = new Hono();
    app.route("/notifications", d1NotifyRoutes);

    const res = await app.request("/notifications");
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("PG notification routes list notifications when authenticated", async () => {
    const mockDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => ({
              limit: mock(async () => [
                {
                  id: "550e8400-e29b-41d4-a716-446655440000",
                  userId: "usr-1",
                  title: "Test",
                  body: "Hello",
                  data: null,
                  isRead: false,
                  readAt: null,
                  createdAt: new Date(),
                  expiresAt: null,
                },
              ]),
            })),
          })),
        })),
      })),
    };

    const app = new Hono<{ Variables: { userId: string; db: any } }>();
    app.use("*", async (c, next) => {
      c.set("userId", "usr-1");
      c.set("db", mockDb);
      await next();
    });
    app.route("/notifications", pgNotifyRoutes);

    const res = await app.request("/notifications");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe("Test");
  });

  test("D1 notification routes list notifications when authenticated", async () => {
    const mockDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => ({
              limit: mock(async () => [
                {
                  id: "660e8400-e29b-41d4-a716-446655440001",
                  userId: "usr-d1",
                  title: "D1 Test",
                  body: "Hello D1",
                  data: null,
                  isRead: false,
                  readAt: null,
                  createdAt: new Date(),
                  expiresAt: null,
                },
              ]),
            })),
          })),
        })),
      })),
    };

    const app = new Hono<{ Variables: { userId: string; db: any } }>();
    app.use("*", async (c, next) => {
      c.set("userId", "usr-d1");
      c.set("db", mockDb);
      await next();
    });
    app.route("/notifications", d1NotifyRoutes);

    const res = await app.request("/notifications");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe("D1 Test");
  });
});
