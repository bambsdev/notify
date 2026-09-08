import { describe, test, expect, mock } from "bun:test";
import { NotificationService, schema } from "../src/d1";

// ─── D1: NotificationService ──────────────────────────────────────────────────
//
// Yang DIUJI: NotificationService dari entrypoint @bambsdev/notify/d1
// Menggunakan SQLite / D1 schema & method signatures

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

function createMockD1Db(overrides: Record<string, any> = {}) {
  return {
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(async () => [
          {
            id: "d1-notif-1",
            userId: "user-d1",
            title: "D1 Notification",
            body: "Testing D1",
            isRead: false,
            createdAt: new Date(),
          },
        ]),
      })),
    })),
    select: mock(() => ({
      from: mock(() => ({
        where: mock(async () => [{ token: "fcm-token-d1" }]),
        orderBy: mock(() => ({
          limit: mock(async () => []),
        })),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(async () => [{ id: "d1-notif-1" }]),
        })),
      })),
    })),
    delete: mock(() => ({
      where: mock(() => ({
        returning: mock(async () => [{ id: "d1-notif-1" }]),
      })),
    })),
    ...overrides,
  } as any;
}

describe("@bambsdev/notify/d1: NotificationService", () => {
  test("creates notification using D1 stack", async () => {
    const db = createMockD1Db();
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.create({
      userId: "user-d1",
      title: "D1 Notification",
      body: "Testing D1",
    });

    expect(result.id).toBe("d1-notif-1");
    expect(result.userId).toBe("user-d1");
    expect(db.insert.mock.calls.length).toBe(1);
  });

  test("marks all read returning count in D1", async () => {
    const db = createMockD1Db({
      update: mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(async () => [{ id: "d1-1" }, { id: "d1-2" }]),
          })),
        })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.markAllRead("user-d1");
    expect(result.count).toBe(2);
  });

  test("deletes expired notifications in D1", async () => {
    const db = createMockD1Db({
      delete: mock(() => ({
        where: mock(() => ({
          returning: mock(async () => [{ id: "d1-expired-1" }]),
        })),
      })),
    });
    const svc = new NotificationService(db, createMockFcm(), createMockAnalytics());

    const result = await svc.deleteExpired(7);
    expect(result.deleted).toBe(1);
  });

  test("verifies D1 schema exports deviceTokens and notifications", () => {
    expect(schema.deviceTokens).toBeDefined();
    expect(schema.notifications).toBeDefined();
  });
});
