import { describe, expect, it, vi } from "vitest";
import { buildQuery, mapPlace, PlacesError, searchPlacesPage } from "./places";

describe("places", () => {
  it("builds a query with area and city", () => {
    expect(buildQuery("private school", "Lahore", "Gulberg")).toBe("private school in Gulberg, Lahore, Pakistan");
    expect(buildQuery("vet clinic", "Multan", null)).toBe("vet clinic in Multan, Pakistan");
  });

  it("maps a Google place and drops closed ones", () => {
    const p = mapPlace({ id: "abc", displayName: { text: " City School " }, internationalPhoneNumber: "+92 42 1234567", websiteUri: "https://x.pk", rating: 4.2, userRatingCount: 50 }, "school");
    expect(p).toMatchObject({ place_id: "abc", name: "City School", phone: "+92 42 1234567", website: "https://x.pk", reviews: 50, keyword: "school" });
    expect(mapPlace({ id: "x", displayName: { text: "Gone" }, businessStatus: "CLOSED_PERMANENTLY" }, "s")).toBeNull();
  });

  it("sends the key in a header, never in the URL, and reads the next page token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ places: [{ id: "1", displayName: { text: "A" } }], nextPageToken: "t2" }), { status: 200 }));
    const page = await searchPlacesPage({ apiKey: "KEY", keyword: "school", city: "Lahore", area: null, pageToken: null, minRating: 3.7, circle: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.nextPageToken).toBe("t2");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("KEY");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("KEY");
    expect(JSON.parse(init.body as string).minRating).toBe(3.5);
  });

  it("treats a rejected key as fatal", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }));
    await expect(searchPlacesPage({ apiKey: "K", keyword: "s", city: "c", area: null, pageToken: null, minRating: null, circle: null, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toMatchObject({ fatal: true, status: 403 } satisfies Partial<PlacesError>);
  });
});
