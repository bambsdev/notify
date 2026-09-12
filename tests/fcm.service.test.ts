import { describe, test, expect, mock } from "bun:test";
import { FCMService } from "../src/services/fcm.service";

describe("FCMService", () => {
  test("embeds icon and badge in webpush configuration when provided", async () => {
    // Generate valid RSA PKCS8 keypair untuk mock service account
    const keyPair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    const privPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const privB64 = btoa(String.fromCharCode(...new Uint8Array(privPkcs8)));
    const fakePem = `-----BEGIN PRIVATE KEY-----\n${privB64}\n-----END PRIVATE KEY-----`;

    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      project_id: "fake-project",
      private_key_id: "fake-id",
      private_key: fakePem,
      client_email: "fake@serviceaccount.com",
    });

    const mockKv = {
      get: mock(async () => "mock-cached-access-token"),
      put: mock(async () => {}),
    } as any;

    const fcm = new FCMService(mockKv, "fake-project", serviceAccountJson);

    let capturedRequestBody: any;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: any, init?: any) => {
      capturedRequestBody = JSON.parse(init?.body);
      return new Response(JSON.stringify({ name: "projects/fake-project/messages/123" }), {
        status: 200,
      });
    }) as any;

    try {
      const res = await fcm.sendToToken("token-abc", {
        title: "Test Title",
        body: "Test Body",
        icon: "/icon-192x192.png",
        badge: "/badge-96x96.png",
        imageUrl: "/image.png",
        data: { link: "/books" },
      });

      expect(res.success).toBe(true);
      expect(capturedRequestBody).toBeDefined();
      expect(capturedRequestBody.message.notification.title).toBe("Test Title");
      expect(capturedRequestBody.message.notification.body).toBe("Test Body");
      expect(capturedRequestBody.message.notification.image).toBe("/image.png");
      expect(capturedRequestBody.message.data).toEqual({ link: "/books" });
      expect(capturedRequestBody.message.webpush).toBeDefined();
      expect(capturedRequestBody.message.webpush.notification.icon).toBe("/icon-192x192.png");
      expect(capturedRequestBody.message.webpush.notification.badge).toBe("/badge-96x96.png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
