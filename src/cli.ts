#!/usr/bin/env node

/**
 * CLI Tool for @bambsdev/notify — VAPID Key Generator
 * Generates ECDSA P-256 Public/Private VAPID Keypair for WebPush.
 */

async function generateVapidKeys() {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const pubRaw = (await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer;
  const privJwk = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;

  const bytes = new Uint8Array(pubRaw);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const publicKey = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const privateKey = (privJwk.d || "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  console.log("\n=======================================================");
  console.log("🔑 @bambsdev/notify — VAPID Key Generator");
  console.log("=======================================================\n");
  console.log("PUBLIC KEY (Non-Sensitif / Simpan di wrangler.toml vars):");
  console.log(publicKey);
  console.log("\nPRIVATE KEY (Sensitif / Simpan via wrangler secret put):");
  console.log(privateKey);
  console.log("\n=======================================================\n");
}

generateVapidKeys().catch((err) => {
  console.error("Gagal men-generate VAPID keys:", err);
  process.exit(1);
});
