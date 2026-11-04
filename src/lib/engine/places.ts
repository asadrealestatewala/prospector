/**
 * Google Places API (New) text search, one page at a time. The key is passed in by the caller,
 * which reads it from the encrypted settings table. It is never logged.
 */
export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.googleMapsUri",
  "places.businessStatus",
  "nextPageToken",
].join(",");

export type PlaceResult = {
  place_id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  hours: string[] | null;
  maps_url: string | null;
  keyword: string;
};

export type PlacesPage = { places: PlaceResult[]; nextPageToken: string | null };

export class PlacesError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Quota, key and permission errors stop the search; others are retried. */
    readonly fatal: boolean,
  ) {
    super(message);
    this.name = "PlacesError";
  }
}

export function buildQuery(keyword: string, city: string, area: string | null): string {
  return `${keyword} in ${area ? `${area}, ` : ""}${city}, Pakistan`;
}

type RawPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  googleMapsUri?: string;
  businessStatus?: string;
};

export function mapPlace(p: RawPlace, keyword: string): PlaceResult | null {
  const name = p.displayName?.text?.trim();
  if (!p.id || !name) return null;
  if (p.businessStatus && p.businessStatus === "CLOSED_PERMANENTLY") return null;
  return {
    place_id: p.id,
    name,
    address: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
    maps_url: p.googleMapsUri ?? null,
    keyword,
  };
}

export async function searchPlacesPage(opts: {
  apiKey: string;
  keyword: string;
  city: string;
  area: string | null;
  pageToken: string | null;
  minRating: number | null;
  circle: { lat: number; lng: number; radiusM: number } | null;
  fetchImpl?: typeof fetch;
}): Promise<PlacesPage> {
  const body: Record<string, unknown> = {
    textQuery: buildQuery(opts.keyword, opts.city, opts.area),
    pageSize: 20,
    regionCode: "PK",
    languageCode: "en",
  };
  if (opts.pageToken) body.pageToken = opts.pageToken;
  // The API accepts 0 to 5 in steps of 0.5.
  if (opts.minRating) body.minRating = Math.min(5, Math.max(0, Math.floor(opts.minRating * 2) / 2));
  if (opts.circle) {
    body.locationBias = {
      circle: { center: { latitude: opts.circle.lat, longitude: opts.circle.lng }, radius: Math.min(50_000, opts.circle.radiusM) },
    };
  }

  const res = await (opts.fetchImpl ?? fetch)("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": opts.apiKey, "X-Goog-FieldMask": PLACES_FIELD_MASK },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    let reason = `Google Places returned ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string; status?: string } };
      if (j.error?.status) reason = `${reason} (${j.error.status})`;
    } catch {
      /* body was not JSON */
    }
    const fatal = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429;
    throw new PlacesError(reason, res.status, fatal);
  }

  const json = (await res.json()) as { places?: RawPlace[]; nextPageToken?: string };
  return {
    places: (json.places ?? []).map((p) => mapPlace(p, opts.keyword)).filter((p): p is PlaceResult => p !== null),
    nextPageToken: json.nextPageToken ?? null,
  };
}
