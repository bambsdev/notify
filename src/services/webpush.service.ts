// src/services/webpush.service.ts
//
// WebPushService — mengelola Native Web Push (VAPID / RFC 8291 aes128gcm).
// 100% kompatibel dengan Cloudflare Workers (Edge runtime) menggunakan Web Crypto API.

import type { FCMPayload, FCMSendResult, WebPushSubscription } from "../types";

export class WebPushService {
  private vapidPublicKey: string;
  private vapidPrivateKey: string;
  private vapidSubject: string;

  constructor(vapidPublicKey: string, vapidPrivateKey: string, vapidSubject: string) {
    this.vapidPublicKey = vapidPublicKey;
    this.vapidPrivateKey = vapidPrivateKey;
    this.vapidSubject = vapidSubject;
  }

  /**
   * Send Web Push notification to a single WebPushSubscription
   */
  async sendNotification(
    sub: WebPushSubscription,
    payload: FCMPayload,
  ): Promise<FCMSendResult> {
    try {
      const endpointUrl = new URL(sub.endpoint);
      const origin = endpointUrl.origin;

      const jwt = await this.createVapidJwt(origin);
      const encryptedPayload = await this.encryptPayload(
        JSON.stringify(payload),
        sub.keys.p256dh,
        sub.keys.auth,
      );

      const response = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${jwt}, k=${this.vapidPublicKey}`,
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "aes128gcm",
          TTL: "86400",
        },
        body: encryptedPayload,
      });

      if (response.ok || response.status === 201) {
        return { success: true };
      }

      if (response.status === 404 || response.status === 410) {
        return {
          success: false,
          invalidToken: true,
          error: `WebPush status ${response.status}`,
        };
      }

      const errorText = await response.text().catch(() => "Unknown error");
      return {
        success: false,
        error: `WebPush error ${response.status}: ${errorText}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Failed to send WebPush notification",
      };
    }
  }

  // ── VAPID JWT (ES256) Generation ──────────────────────────────────────────

  private async createVapidJwt(audience: string): Promise<string> {
    const header = { alg: "ES256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 12 * 3600; // 12 hours

    const payload = {
      aud: audience,
      exp,
      sub: this.vapidSubject,
    };

    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedPayload = this.base64url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const privateKey = await this.importVapidPrivateKey();
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      new TextEncoder().encode(unsignedToken),
    );

    return `${unsignedToken}.${this.base64urlBuffer(signature)}`;
  }

  private async importVapidPrivateKey(): Promise<CryptoKey> {
    const privKeyBytes = this.urlBase64ToUint8Array(this.vapidPrivateKey);
    const pubKeyBytes = this.urlBase64ToUint8Array(this.vapidPublicKey);

    // Uncompressed P-256 EC public key is 65 bytes starting with 0x04
    const x = this.base64urlBuffer(pubKeyBytes.slice(1, 33));
    const y = this.base64urlBuffer(pubKeyBytes.slice(33, 65));
    const d = this.base64urlBuffer(privKeyBytes);

    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      x,
      y,
      d,
      ext: true,
    };

    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  }

  // ── Payload Encryption (RFC 8291 aes128gcm) ───────────────────────────────

  private async encryptPayload(
    payloadText: string,
    p256dhB64: string,
    authB64: string,
  ): Promise<ArrayBuffer> {
    const clientPubKeyBytes = this.urlBase64ToUint8Array(p256dhB64);
    const clientAuthBytes = this.urlBase64ToUint8Array(authB64);

    // 1. Generate 16 random salt bytes
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // 2. Generate local ephemeral keypair (ECDH P-256)
    const localKeyPair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;

    const localPubKeyBuffer = (await crypto.subtle.exportKey(
      "raw",
      localKeyPair.publicKey,
    )) as ArrayBuffer;
    const localPubKeyBytes = new Uint8Array(localPubKeyBuffer);

    // 3. Import client public key
    const clientPubKey = await crypto.subtle.importKey(
      "raw",
      clientPubKeyBytes,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );

    // 4. Derive shared secret (32 bytes)
    const sharedSecretBuffer = await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientPubKey } as any,
      localKeyPair.privateKey,
      256,
    );
    const sharedSecretBytes = new Uint8Array(sharedSecretBuffer);

    // 5. HKDF Derivations
    // PRK = HKDF-Extract(salt = clientAuth, IKM = sharedSecret)
    const prk = await this.hkdfExtract(clientAuthBytes, sharedSecretBytes);

    // key_info = "WebPush: info\0" + clientPubKey + localPubKey
    const infoHeader = new TextEncoder().encode("WebPush: info\0");
    const keyInfo = this.concatBytes(infoHeader, clientPubKeyBytes, localPubKeyBytes);

    // PRK_key = HKDF-Expand(PRK, key_info, 32)
    const prkKey = await this.hkdfExpand(prk, keyInfo, 32);

    // CEK = HKDF-Expand(PRK_key, "Content-Encoding: aes128gcm\0", 16)
    const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
    const cekBytes = await this.hkdfExpand(prkKey, cekInfo, 16);

    // Nonce = HKDF-Expand(PRK_key, "Content-Encoding: nonce\0", 12)
    const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
    const nonceBytes = await this.hkdfExpand(prkKey, nonceInfo, 12);

    // 6. AES-GCM Encrypt payload with padding (delimeter \x02 at end)
    const payloadBytes = new TextEncoder().encode(payloadText);
    const paddedPayload = new Uint8Array(payloadBytes.length + 1);
    paddedPayload.set(payloadBytes, 0);
    paddedPayload[payloadBytes.length] = 2; // \x02 end-of-record delimiter

    const aesKey = await crypto.subtle.importKey(
      "raw",
      cekBytes,
      "AES-GCM",
      false,
      ["encrypt"],
    );

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonceBytes },
      aesKey,
      paddedPayload,
    );
    const ciphertextBytes = new Uint8Array(ciphertextBuffer);

    // 7. Assemble aes128gcm header + ciphertext
    // Header format: salt (16B) || recordSize (4B = 4096) || idLen (1B = 65) || localPubKey (65B) || ciphertext
    const recordSize = 4096;
    const headerBuffer = new ArrayBuffer(16 + 4 + 1 + 65 + ciphertextBytes.length);
    const view = new DataView(headerBuffer);
    const uint8View = new Uint8Array(headerBuffer);

    uint8View.set(salt, 0);
    view.setUint32(16, recordSize, false); // Big-Endian uint32
    uint8View[20] = 65; // idLen (length of uncompressed P-256 key)
    uint8View.set(localPubKeyBytes, 21);
    uint8View.set(ciphertextBytes, 21 + 65);

    return headerBuffer;
  }

  // ── HKDF Helpers ──────────────────────────────────────────────────────────

  private async hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
      "raw",
      salt,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, ikm);
    return new Uint8Array(signature);
  }

  private async hkdfExpand(
    prk: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
      "raw",
      prk,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const infoWithCounter = new Uint8Array(info.length + 1);
    infoWithCounter.set(info, 0);
    infoWithCounter[info.length] = 1;
    const signature = await crypto.subtle.sign("HMAC", key, infoWithCounter);
    return new Uint8Array(signature).slice(0, length);
  }

  // ── Utility Functions ─────────────────────────────────────────────────────

  private concatBytes(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, "+")
      .replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  private base64url(str: string): string {
    return btoa(str)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  private base64urlBuffer(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
}
