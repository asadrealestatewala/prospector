import { describe, expect, it, vi } from "vitest";
import { localCheck, mapProviderResponse, ProviderError, verifyWithProvider } from "./email-verify";

const mx = (map: Record<string, string[] | "down">) => async (d: string) => {
  const v = map[d];
  if (v === "down") throw new Error("ESERVFAIL");
  return v ?? [];
};

describe("free email checks", () => {
  it("rejects bad format, throwaway domains and domains without a mail server", async () => {
    expect(await localCheck("info@@x.pk", mx({}))).toMatchObject({ pass: false, result: "invalid" });
    expect(await localCheck("a..b@x.pk", mx({}))).toMatchObject({ pass: false });
    expect(await localCheck("x@mailinator.com", mx({ "mailinator.com": ["mx"] }))).toMatchObject({ pass: false, detail: expect.stringMatching(/throwaway/) });
    expect(await localCheck("info@nomail.pk", mx({}))).toMatchObject({ pass: false, detail: expect.stringMatching(/no mail server/) });
  });
  it("passes a good address, and leaves it for the paid check when DNS is down", async () => {
    expect(await localCheck("Info@School.edu.pk", mx({ "school.edu.pk": ["mx1.school.edu.pk"] }))).toMatchObject({ pass: true });
    expect(await localCheck("info@school.pk", mx({ "school.pk": "down" }))).toMatchObject({ pass: true });
  });
});

describe("verification services", () => {
  it("maps each service's answers", () => {
    expect(mapProviderResponse("millionverifier", { result: "ok" }).result).toBe("valid");
    expect(mapProviderResponse("millionverifier", { result: "catch_all" }).result).toBe("risky");
    expect(mapProviderResponse("millionverifier", { result: "disposable" }).result).toBe("invalid");
    expect(mapProviderResponse("zerobounce", { status: "valid" }).result).toBe("valid");
    expect(mapProviderResponse("zerobounce", { status: "spamtrap" }).result).toBe("invalid");
    expect(mapProviderResponse("zerobounce", { status: "catch-all" }).result).toBe("risky");
    expect(mapProviderResponse("neverbounce", { status: "success", result: "invalid" }).result).toBe("invalid");
    expect(mapProviderResponse("neverbounce", { status: "success", result: "catchall" }).result).toBe("risky");
  });
  it("treats a wrong key as final and a busy service as worth retrying", async () => {
    expect(() => mapProviderResponse("neverbounce", { status: "auth_failure" })).toThrow(ProviderError);
    const refused = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(verifyWithProvider("zerobounce", "K", "a@b.pk", refused as unknown as typeof fetch)).rejects.toMatchObject({ fatal: true });
    const busy = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(verifyWithProvider("zerobounce", "K", "a@b.pk", busy as unknown as typeof fetch)).rejects.toMatchObject({ fatal: false });
  });
  it("sends the address to the chosen service", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({ status: "success", result: "valid" }), { status: 200 }));
    expect(await verifyWithProvider("neverbounce", "KEY", "info@school.pk", f as unknown as typeof fetch)).toMatchObject({ result: "valid" });
    expect(f.mock.calls[0][0]).toContain("https://api.neverbounce.com/v4/single/check?key=KEY&email=info%40school.pk");
    expect(f.mock.calls[0][1]?.method).toBe("POST");
  });
});
