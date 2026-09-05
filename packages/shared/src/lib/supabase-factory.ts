/**
 * Shared Supabase client factory
 *
 * Replaces 8+ duplicate createClient() calls across the codebase.
 * Two modes:
 *   - getSupabase()        → uses service key (preferred) or anon key
 *   - getSupabaseAnon()    → uses anon key only (for RLS-respecting queries)
 *
 * Returns null if env vars are missing (graceful degradation for offline/local mode).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _serviceClient: SupabaseClient | null = null;
let _anonClient: SupabaseClient | null = null;

/**
 * Get a Supabase client with the highest-privilege key available.
 * Prefers SUPABASE_SERVICE_KEY, falls back to SUPABASE_ANON_KEY.
 * Returns null if SUPABASE_URL is not set.
 */
export function getSupabase(): SupabaseClient | null {
  if (_serviceClient) return _serviceClient;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const key = serviceKey || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  if (!serviceKey) {
    console.warn("[SupabaseFactory] SUPABASE_SERVICE_KEY not set — falling back to anon key (RLS enforced)");
  }

  _serviceClient = createClient(url, key);
  return _serviceClient;
}

/**
 * Get a Supabase client using only the anon key (RLS-respecting).
 * Returns null if SUPABASE_URL or SUPABASE_ANON_KEY is not set.
 */
export function getSupabaseAnon(): SupabaseClient | null {
  if (_anonClient) return _anonClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  _anonClient = createClient(url, key);
  return _anonClient;
}

/**
 * Reset cached clients (for testing).
 */
export function resetSupabaseClients(): void {
  _serviceClient = null;
  _anonClient = null;
}

// Re-export types consumers may need
export { type SupabaseClient } from "@supabase/supabase-js";
