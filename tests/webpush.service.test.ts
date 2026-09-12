import { describe, test, expect, mock, beforeEach } from "bun:test";
import { WebPushService } from "../src/services/webpush.service";

describe("WebPushService", () => {
  let vapidKeys: { publicKey: string; privateKey: string };

  beforeEach(async () => {
    // Generate valid EC P-256 keypair untuk testing
    const keyPair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    const toB64Url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    vapidKeys = {
      publicKey: toB64Url(new Uint8Array(pubRaw)),
      privateKey: privJwk.d!,
    };
  });

  test("rejects subscription when p256dh or auth key is missing", async () => {
    const service = new WebPushService(
      vapidKeys.publicKey,
      vapidKeys.privateKey,
      "mailto:admin@example.com",
    );

    const res = await service.sendNotification(
      {
        endpoint: "https://push.example.com/sub/123",
        keys: { p256dh: "", auth: "" },
      },
      { title: "Test", body: "Hello" },
    );

    expect(res.success).toBe(false);
    expect(res.invalidToken).toBe(true);
  });

  test("encrypts and delivers payload containing icon and badge", async () => {
    const service = new WebPushService(
      vapidKeys.publicKey,
      vapidKeys.privateKey,
      "mailto:admin@example.com",
    );

    // Generate dummy client P-256 keypair (simulasi browser subscription)
    const clientKeyPair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    const clientPubRaw = await crypto.subtle.exportKey("raw", clientKeyPair.publicKey);
    const clientAuth = crypto.getRandomValues(new Uint8Array(16));

    const toB64Url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/fake-sub-token",
      keys: {
        p256dh: toB64Url(new Uint8Array(clientPubRaw)),
        auth: toB64Url(clientAuth),
      },
    };

    let capturedHeaders: Headers | undefined;
    let capturedBody: any;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: any, init?: any) => {
      capturedHeaders = new Headers(init?.headers);
      capturedBody = init?.body;
      return new Response(null, { status: 201 });
    }) as any;

    try {
      const res = await service.sendNotification(sub, {
        title: "Pemberitahuan Rakkita",
        body: "Buku baru tersedia!",
        icon: "/icon-192x192.png",
        badge: "/badge-96x96.png",
        imageUrl: "/cover.png",
        data: { slug: "fiqih-muamalah" },
      });

      expect(res.success).toBe(true);
      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.get("Content-Encoding")).toBe("aes128gcm");
      expect(capturedHeaders!.get("TTL")).toBe("86400");
      expect(capturedHeaders!.get("Authorization")).toContain("vapid t=");
      expect(capturedBody).toBeInstanceOf(ArrayBuffer);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("handles 404 or 410 response by marking token as invalid", async () => {
    const service = new WebPushService(
      vapidKeys.publicKey,
      vapidKeys.privateKey,
      "mailto:admin@example.com",
    );

    const clientKeyPair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    const clientPubRaw = await crypto.subtle.exportKey("raw", clientKeyPair.publicKey);
    const clientAuth = crypto.getRandomValues(new Uint8Array(16));

    const toB64Url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const sub = {
      endpoint: "https://push.services.mozilla.com/wpush/v2/expired",
      keys: {
        p256dh: toB64Url(new Uint8Array(clientPubRaw)),
        auth: toB64Url(clientAuth),
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response("Subscription has expired", { status: 410 });
    }) as any;

    try {
      const res = await service.sendNotification(sub, {
        title: "Expired",
        body: "Test",
      });

      expect(res.success).toBe(false);
      expect(res.invalidToken).toBe(true);
      expect(res.error).toContain("410");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
