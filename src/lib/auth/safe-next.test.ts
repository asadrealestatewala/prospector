import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps relative paths", () => expect(safeNext("/leads?x=1")).toBe("/leads?x=1"));
  it("blocks other hosts", () => {
    expect(safeNext("//evil.com")).toBeNull();
    expect(safeNext("https://evil.com")).toBeNull();
    expect(safeNext("/\\evil.com")).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});
