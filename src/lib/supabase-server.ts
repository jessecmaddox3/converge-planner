import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;

export function getSupabaseServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (url && key) {
    if (!serviceClient) {
      serviceClient = createClient(url, key, {
        auth: { persistSession: false },
        global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
      });
    }
    return serviceClient;
  }

  if (process.env.NODE_ENV !== "test" || process.env.VERCEL || process.env.CONVERGE_MODE === "production") {
    throw new Error("Server storage is not configured");
  }
  return null;
}
