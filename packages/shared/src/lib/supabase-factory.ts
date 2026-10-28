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

import "./load-env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isTestMode } from "./test-mode";

type CachedClient = { url: string; client: SupabaseClient };
let _serviceClient: CachedClient | null = null;
let _anonClient: CachedClient | null = null;

function supabaseAllowed(url: string | undefined): boolean {
  if (!isTestMode()) return true;
  if (process.env.GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS !== "1") return false;
  if (!url) return false;
  const hostname = new URL(url).hostname.toLowerCase();
  if (url.toLowerCase().includes("mkijzwkuubtfjqcemorx") || hostname.includes("mkijzwkuubtfjqcemorx")) return false;
  // An arbitrary custom domain could alias production. Opt-in is limited to
  // loopback or a nonproduction project whose identity is visible in its host.
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
    /^[a-z0-9]{20}\.supabase\.co$/.test(hostname);
}

/** Shared boundary for callers supplying explicit credentials. */
export function createSupabaseClient(url: string, key: string): SupabaseClient {
  if (!supabaseAllowed(url)) {
    throw new Error("Supabase is disabled in tests; production is never allowed");
  }
  return createClient(url, key);
}

/**
 * Get a Supabase client with the highest-privilege key available.
 * Prefers SUPABASE_SERVICE_KEY, falls back to SUPABASE_ANON_KEY.
 * Returns null if SUPABASE_URL is not set.
 */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseAllowed(process.env.SUPABASE_URL)) return null;
  if (_serviceClient) return supabaseAllowed(_serviceClient.url) ? _serviceClient.client : null;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const key = serviceKey || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  if (!serviceKey) {
    console.warn("[SupabaseFactory] SUPABASE_SERVICE_KEY not set — falling back to anon key (RLS enforced)");
  }

  _serviceClient = { url, client: createSupabaseClient(url, key) };
  return _serviceClient.client;
}

/**
 * Get a Supabase client using only the anon key (RLS-respecting).
 * Returns null if SUPABASE_URL or SUPABASE_ANON_KEY is not set.
 */
export function getSupabaseAnon(): SupabaseClient | null {
  if (!supabaseAllowed(process.env.SUPABASE_URL)) return null;
  if (_anonClient) return supabaseAllowed(_anonClient.url) ? _anonClient.client : null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  _anonClient = { url, client: createSupabaseClient(url, key) };
  return _anonClient.client;
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
