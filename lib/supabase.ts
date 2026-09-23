import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const adminSessionKey = "sde-admin-session";

const sessionFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem(adminSessionKey);
    if (token) headers.set("x-admin-session", token);
  }
  return fetch(input, { ...init, headers });
};

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseKey || "placeholder",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: sessionFetch },
  },
);

export const supabaseProjectId = supabaseUrl
  .replace(/^https:\/\//, "")
  .split(".")[0];
