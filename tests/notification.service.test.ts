import { describe, test, expect, mock } from "bun:test";
import { NotificationService } from "../src/services/notification.service";

// ─── notify: NotificationService ─────────────────────────────────────────────
//
// Mock: DB (Drizzle) + FCMService + AnalyticsEngineDataset
// Yang DIUJI: business logic routing — create, list, markRead, unreadCount, pruneInvalidTokens
// Anti-pattern dihindari: tidak test mock internals, tidak test FCM response details

// ── Mock factories ────────────────────────────────────────────────────────────

function createMockFcm(batchResult = { successCount: 1, failureCount: 0, failedTokens: [] as string[] }) {
  return {
    sendToTokens: mock(async () => batchResult),
    sendToToken: mock(async () => ({ success: true, messageId: "msg-1" })),
    sendToTopic: mock(async () => ({ success: true, messageId: "msg-topic-1" })),
    getAccessToken: mock(async () => "mock-access-token"),
  } as any;
}

function createMockAnalytics() {
  return {
    writeDataPoint: mock(() => {}),
  } as any;
}

function createNotifInsertChain(returnedNotif: any) {
  return mock(() => ({
    values: mock(() => ({
      returning: mock(async () => [returnedNotif]),
    })),
  }));
}

function createMockDb(overrides: Record<string, any> = {}) {
  return {
    insert: createNotifInsertChain({
      id: "notif-1",
      userId: "user-1",
      title: "Hello",
      body: "World",
      isRead: false,
      createdAt: new Date(),
    }),
    select: mock(() => ({
      from: mock(() => ({
        where: mock(async () => [{ token: "fcm-token-1" }]),
        orderBy: mock(() => ({
          limit: mock(async () => []),
        })),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(async () => ({ rowCount: 1 })),
      })),
    })),
    delete: mock(() => ({
      where: mock(async () => ({ rowCount: 1 })),
    })),
    ...overrides,
  } as any;
}

// ─── NotificationService.create ───────────────────────────────────────────────

describe("notify/NotificationService: create", () => {
  test("inserts notification and returns it", async () => {
    const db = createMockDb();
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.create({
      userId: "user-1",
      title: "Hello",
      body: "World",
    });

    expect(result.id).toBe("notif-1");
    expect(result.userId).toBe("user-1");
    expect(db.insert.mock.calls.length).toBe(1);
  });

  test("does NOT send FCM when withPush is false", async () => {
    const fcm = createMockFcm();
    const svc = new NotificationService(createMockDb(), fcm, createMockAnalytics());

    await svc.create({ userId: "user-1", title: "T", body: "B", withPush: false });

    expect(fcm.sendToTokens.mock.calls.length).toBe(0);
  });

  test("does NOT send FCM when withPush not specified (default false)", async () => {
    const fcm = createMockFcm();
    const svc = new NotificationService(createMockDb(), fcm, createMockAnalytics());

    await svc.create({ userId: "user-1", title: "T", body: "B" });

    expect(fcm.sendToTokens.mock.calls.length).toBe(0);
  });

  test("sends FCM push when withPush=true and user has device tokens", async () => {
    const fcm = createMockFcm({ successCount: 1, failureCount: 0, failedTokens: [] });
    const db = createMockDb({
      select: mock(() => ({
        from: mock(() => ({
          where: mock(async () => [{ token: "fcm-token-1" }, { token: "fcm-token-2" }]),
        })),
      })),
    });
    const svc = new NotificationService(db, fcm, createMockAnalytics());

    await svc.create({ userId: "user-1", title: "T", body: "B", withPush: true });

    expect(fcm.sendToTokens.mock.calls.length).toBe(1);
    // Verify token list dikirim ke FCM
    const sentTokens = fcm.sendToTokens.mock.calls[0][0];
    expect(sentTokens).toContain("fcm-token-1");
    expect(sentTokens).toContain("fcm-token-2");
  });

  test("skips FCM when withPush=true but user has no device tokens", async () => {
    const fcm = createMockFcm();
    const db = createMockDb({
      select: mock(() => ({
        from: mock(() => ({
          where: mock(async () => []), // no device tokens
        })),
      })),
    });
    const svc = new NotificationService(db, fcm, createMockAnalytics());

    await svc.create({ userId: "user-1", title: "T", body: "B", withPush: true });

    expect(fcm.sendToTokens.mock.calls.length).toBe(0);
  });

  test("prunes invalid tokens when FCM returns failedTokens", async () => {
    const fcm = createMockFcm({
      successCount: 0,
      failureCount: 1,
      failedTokens: ["stale-token"],
    });
    const db = createMockDb({
      select: mock(() => ({
        from: mock(() => ({
          where: mock(async () => [{ token: "stale-token" }]),
        })),
      })),
    });
    const svc = new NotificationService(db, fcm, createMockAnalytics());

    await svc.create({ userId: "user-1", title: "T", body: "B", withPush: true });

    // DB.delete harus dipanggil untuk stale-token
    expect(db.delete.mock.calls.length).toBeGreaterThan(0);
  });

  test("includes optional fields (imageUrl, data, expiresAt) in insert", async () => {
    let capturedValues: any = null;
    const db = createMockDb({
      insert: mock(() => ({
        values: mock((vals: any) => {
          capturedValues = vals;
          return { returning: mock(async () => [{ id: "n1", ...vals }]) };
        }),
      })),
    });
    const expiresAt = new Date(Date.now() + 86400000);
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    await svc.create({
      userId: "user-1",
      title: "T",
      body: "B",
      imageUrl: "https://example.com/img.jpg",
      data: { action: "open" },
      expiresAt,
    });

    expect(capturedValues.imageUrl).toBe("https://example.com/img.jpg");
    expect(capturedValues.data).toEqual({ action: "open" });
    expect(capturedValues.expiresAt).toEqual(expiresAt);
  });
});

// ─── NotificationService.markRead ─────────────────────────────────────────────

describe("notify/NotificationService: markRead", () => {
  test("throws NOT_FOUND when notification does not exist", async () => {
    const db = createMockDb({
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(async () => []), // not found
          })),
        })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    await expect(svc.markRead("notif-404", "user-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("throws FORBIDDEN when notification belongs to different user", async () => {
    const db = createMockDb({
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(async () => [{ id: "notif-1", userId: "other-user" }]),
          })),
        })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    await expect(svc.markRead("notif-1", "user-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("marks notification as read when owned by user", async () => {
    const db = createMockDb({
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(async () => [{ id: "notif-1", userId: "user-1" }]),
          })),
        })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    await svc.markRead("notif-1", "user-1");

    expect(db.update.mock.calls.length).toBe(1);
  });
});

// ─── NotificationService.markAllRead ──────────────────────────────────────────

describe("notify/NotificationService: markAllRead", () => {
  test("returns count of updated notifications", async () => {
    const db = createMockDb({
      update: mock(() => ({
        set: mock(() => ({
          where: mock(async () => ({ rowCount: 5 })),
        })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.markAllRead("user-1");

    expect(result.count).toBe(5);
  });

  test("returns count=0 when no unread notifications", async () => {
    const db = createMockDb({
      update: mock(() => ({
        set: mock(() => ({
          where: mock(async () => ({ rowCount: 0 })),
        })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.markAllRead("user-1");
    expect(result.count).toBe(0);
  });
});

// ─── NotificationService.pruneInvalidTokens ───────────────────────────────────

describe("notify/NotificationService: pruneInvalidTokens", () => {
  test("does nothing when empty token list provided", async () => {
    const db = createMockDb();
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    await svc.pruneInvalidTokens([]);

    expect(db.delete.mock.calls.length).toBe(0);
  });

  test("calls db.delete for each invalid token", async () => {
    const db = createMockDb();
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    await svc.pruneInvalidTokens(["token-a", "token-b", "token-c"]);

    expect(db.delete.mock.calls.length).toBe(3);
  });

  test("calls db.delete once per token (not batch)", async () => {
    const db = createMockDb();
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    await svc.pruneInvalidTokens(["tok-1", "tok-2"]);

    expect(db.delete.mock.calls.length).toBe(2);
  });
});

// ─── NotificationService.deleteExpired ────────────────────────────────────────

describe("notify/NotificationService: deleteExpired", () => {
  test("calls db.delete and returns deleted count", async () => {
    const db = createMockDb({
      delete: mock(() => ({
        where: mock(async () => ({ rowCount: 10 })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.deleteExpired(30);

    expect(result.deleted).toBe(10);
    expect(db.delete.mock.calls.length).toBe(1);
  });

  test("uses default 30 days when not specified", async () => {
    const db = createMockDb({
      delete: mock(() => ({
        where: mock(async () => ({ rowCount: 3 })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.deleteExpired(); // default = 30 days

    expect(result.deleted).toBe(3);
  });

  test("returns deleted=0 when rowCount is null/undefined", async () => {
    const db = createMockDb({
      delete: mock(() => ({
        where: mock(async () => ({ rowCount: null })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.deleteExpired();
    expect(result.deleted).toBe(0);
  });
});
