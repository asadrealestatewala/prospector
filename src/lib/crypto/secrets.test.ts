import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, lastFour, maskSecret, parseEncryptionKey } from "./secrets";

const key = randomBytes(32);

describe("settings encryption", () => {
  it("round-trips a key", () => {
    const stored = encryptSecret("AIzaSy-test-key-1234", key, "google.places_api_key");
    expect(stored).not.toContain("AIzaSy");
    expect(decryptSecret(stored, key, "google.places_api_key")).toBe("AIzaSy-test-key-1234");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("refuses a value moved to another setting", () => {
    const stored = encryptSecret("secret", key, "resend.api_key");
    expect(() => decryptSecret(stored, key, "botlinkd.app_key")).toThrow();
  });

  it("refuses a tampered value or wrong key", () => {
    const stored = encryptSecret("secret", key);
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
  });

  it("validates the key length", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/not set/);
    expect(() => parseEncryptionKey(Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
    expect(parseEncryptionKey(key.toString("base64")).length).toBe(32);
  });

  it("masks keys", () => {
    expect(lastFour("re_abcdef1234")).toBe("1234");
    expect(lastFour("abc")).toBe("");
    expect(maskSecret("1234")).toBe("••••••••1234");
    expect(maskSecret(null)).toBe("Not set");
  });
});
