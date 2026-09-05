/**
 * Database layer — barrel re-export.
 *
 * Canonical import path for new code:
 *   import { getSupabase } from "@golems/shared/lib/db";
 *
 * Old imports still work:
 *   import { getSupabase } from "@golems/shared/lib/supabase-factory";
 */
export {
  getSupabase,
  getSupabaseAnon,
  resetSupabaseClients,
  type SupabaseClient,
} from "../supabase-factory";
