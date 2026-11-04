import { describe, expect, it } from "vitest";
import { lockedUntil } from "./lockout";

const now = new Date("2026-11-04T10:00:00Z");
const ago = (min: number, ok = false) => ({ succeeded: ok, created_at: new Date(now.getTime() - min * 60_000).toISOString() });

describe("login lockout", () => {
  it("is not locked after four failures", () => {
    expect(lockedUntil([ago(1), ago(2), ago(3), ago(4)], now)).toBeNull();
  });
  it("locks after five failures for 15 minutes from the latest", () => {
    const until = lockedUntil([ago(1), ago(2), ago(3), ago(4), ago(5)], now);
    expect(until?.toISOString()).toBe("2026-11-04T10:14:00.000Z");
  });
  it("ignores failures before the last success", () => {
    expect(lockedUntil([ago(1), ago(2), ago(3, true), ago(4), ago(5), ago(6)], now)).toBeNull();
  });
  it("unlocks once the window passes", () => {
    expect(lockedUntil([ago(16), ago(17), ago(18), ago(19), ago(20)], now)).toBeNull();
  });
});
