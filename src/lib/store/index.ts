import { LocalStore } from "./local";
import { SupabaseStore } from "./supabase";
import type { Store } from "./types";

const g = globalThis as unknown as { __gepStore?: Store };

/** `STORE=supabase` uses Postgres; anything else uses the local JSON index (default, zero setup). */
export function getStore(): Store {
  return (g.__gepStore ??= process.env.STORE === "supabase" ? new SupabaseStore() : new LocalStore());
}

export type { Store } from "./types";
