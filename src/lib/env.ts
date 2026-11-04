import "server-only";
import { z } from "zod";

/**
 * Server environment. Keys and secrets are read only on the server and never sent to the browser.
 * See .env.example for every variable.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SETTINGS_ENCRYPTION_KEY: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Server environment is incomplete. Set these variables: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}
