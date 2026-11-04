import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for API keys stored in the settings table.
 * AES-256-GCM with a random 12-byte IV per value. Stored as "v1.<iv>.<tag>.<ciphertext>" (base64url).
 * The 32-byte key comes from SETTINGS_ENCRYPTION_KEY (base64) and never leaves the server.
 */
const VERSION = "v1";

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("SETTINGS_ENCRYPTION_KEY is not set.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64 encoded (generate with: openssl rand -base64 32).");
  }
  return key;
}

export function encryptSecret(plain: string, key: Buffer, aad = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecret(stored: string, key: Buffer, aad = ""): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("Stored secret has an unknown format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** Last four characters for the masked display, e.g. "••••••••3f9a". */
export function lastFour(plain: string): string {
  return plain.length <= 4 ? "" : plain.slice(-4);
}

export { maskSecret } from "./mask";
