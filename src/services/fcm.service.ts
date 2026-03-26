// src/services/fcm.service.ts
//
// FCMService — mengelola Firebase Cloud Messaging HTTP v1 API.
//
// Flow:
//   1. OAuth2 JWT generation via crypto.subtle (RS256)
//   2. Cache access token di KV (TTL 55 menit, token valid 60 menit)
//   3. Single/multi-device push + topic push

import type {
  FCMPayload,
  FCMSendResult,
  FCMBatchResult,
  ServiceAccountKey,
} from "../types";

export class FCMService {
  private readonly kv: KVNamespace;
  private readonly projectId: string;
  private readonly serviceAccountKey: ServiceAccountKey;
  private readonly KV_TOKEN_KEY = "fcm:oauth_token";
  private readonly FCM_SCOPE =
    "https://www.googleapis.com/auth/firebase.messaging";
  private readonly FCM_URL: string;

  constructor(
    kv: KVNamespace,
    projectId: string,
    serviceAccountKeyJson: string,
  ) {
    this.kv = kv;
    this.projectId = projectId;
    this.serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    this.FCM_URL = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  }

  // ── OAuth2 Token Management ─────────────────────────────────────────────────

  /**
   * Mendapatkan OAuth2 access token.
   * 1. Cek cache KV
   * 2. Jika tidak ada atau expired → generate JWT → exchange ke Google → simpan ke KV
   */
  async getAccessToken(): Promise<string> {
    // 1. Check KV cache
    const cached = await this.kv.get(this.KV_TOKEN_KEY);
    if (cached) return cached;

    // 2. Generate JWT
    const jwt = await this.generateJWT();

    // 3. Exchange JWT for access token
    const accessToken = await this.exchangeJWTForToken(jwt);

    // 4. Cache ke KV dengan TTL 55 menit (token valid 60 menit, margin 5 menit)
    await this.kv.put(this.KV_TOKEN_KEY, accessToken, {
      expirationTtl: 55 * 60,
    });

    return accessToken;
  }

  /**
   * Generate JWT untuk Google OAuth2 service account.
   * Menggunakan Web Crypto API (tersedia di CF Workers).
   */
  private async generateJWT(): Promise<string> {
    // Import RSA private key dari service account
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      this.pemToArrayBuffer(this.serviceAccountKey.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );

    // Buat header + payload JWT
    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iss: this.serviceAccountKey.client_email,
      sub: this.serviceAccountKey.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: this.FCM_SCOPE,
    };

    // Encode and sign
    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedPayload = this.base64url(JSON.stringify(jwtPayload));
    const data = `${encodedHeader}.${encodedPayload}`;

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(data),
    );

    return `${data}.${this.base64urlBuffer(signature)}`;
  }

  /**
   * Exchange JWT ke Google OAuth2 token endpoint.
   */
  private async exchangeJWTForToken(jwt: string): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange JWT for token: ${error}`);
    }

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  // ── Send Methods ────────────────────────────────────────────────────────────

  /**
   * Kirim push notification ke satu FCM token.
   * Jika response 404 (token tidak valid), return { success: false, invalidToken: true }
   */
  async sendToToken(token: string, payload: FCMPayload): Promise<FCMSendResult> {
    const accessToken = await this.getAccessToken();

    const body: Record<string, any> = {
      message: {
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
      },
    };

    if (payload.imageUrl) {
      body.message.notification.image = payload.imageUrl;
    }

    if (payload.data) {
      body.message.data = payload.data;
    }

    const response = await fetch(this.FCM_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const result = (await response.json()) as { name: string };
      return { success: true, messageId: result.name };
    }

    // Token tidak valid / expired — harus dihapus dari DB
    if (response.status === 404 || response.status === 400) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: { details?: Array<{ errorCode?: string }> };
      };
      const errorCode = errorBody?.error?.details?.[0]?.errorCode;

      if (
        errorCode === "UNREGISTERED" ||
        errorCode === "INVALID_ARGUMENT" ||
        response.status === 404
      ) {
        return { success: false, invalidToken: true, error: errorCode };
      }
    }

    const errorText = await response.text().catch(() => "Unknown error");
    return { success: false, error: `FCM error ${response.status}: ${errorText}` };
  }

  /**
   * Kirim push notification ke banyak token sekaligus.
   * Menggunakan Promise.allSettled agar partial failure tidak membatalkan semua.
   */
  async sendToTokens(
    tokens: string[],
    payload: FCMPayload,
  ): Promise<FCMBatchResult> {
    const results = await Promise.allSettled(
      tokens.map((token) => this.sendToToken(token, payload)),
    );

    let successCount = 0;
    const failedTokens: string[] = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value.success) {
        successCount++;
      } else if (result.status === "fulfilled" && result.value.invalidToken) {
        failedTokens.push(tokens[index]);
      }
      // Token yang error 500 dari FCM → jangan hapus, coba lagi nanti
    });

    return {
      successCount,
      failureCount: tokens.length - successCount,
      failedTokens,
    };
  }

  /**
   * Kirim push notification ke FCM topic.
   */
  async sendToTopic(
    topic: string,
    payload: FCMPayload,
  ): Promise<FCMSendResult> {
    const accessToken = await this.getAccessToken();

    const body: Record<string, any> = {
      message: {
        topic,
        notification: {
          title: payload.title,
          body: payload.body,
        },
      },
    };

    if (payload.imageUrl) {
      body.message.notification.image = payload.imageUrl;
    }

    if (payload.data) {
      body.message.data = payload.data;
    }

    const response = await fetch(this.FCM_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const result = (await response.json()) as { name: string };
      return { success: true, messageId: result.name };
    }

    const errorText = await response.text().catch(() => "Unknown error");
    return {
      success: false,
      error: `FCM topic error ${response.status}: ${errorText}`,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Strip PEM header/footer dan decode base64 ke ArrayBuffer.
   */
  private pemToArrayBuffer(pem: string): ArrayBuffer {
    const b64 = pem
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s/g, "");
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Base64url encode string.
   */
  private base64url(str: string): string {
    const encoded = btoa(str);
    return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /**
   * Base64url encode ArrayBuffer.
   */
  private base64urlBuffer(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
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
