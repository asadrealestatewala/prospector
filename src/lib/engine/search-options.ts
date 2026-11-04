import { z } from "zod";

/** Options saved on each search (SRS screen 3, step 4). */
export const searchOptionsSchema = z.object({
  maxPerCity: z.coerce.number().int().min(1).max(1000).default(60),
  minRating: z.coerce.number().min(0).max(5).nullable().default(null),
  requireWebsite: z.boolean().default(false),
  skipExisting: z.boolean().default(true),
  autoCrawl: z.boolean().default(true),
});
export type SearchOptions = z.infer<typeof searchOptionsSchema>;

export function parseSearchOptions(raw: unknown): SearchOptions {
  const parsed = searchOptionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : searchOptionsSchema.parse({});
}
