import {
  isDbConfigured,
  isPostgresConfigured,
  isSupabaseRestConfigured,
  supabaseClient,
} from "./db";

// Backward-compatibility exports
export const isSupabaseConfigured = isDbConfigured;
export const isDirectPostgres = isPostgresConfigured;
export const isRestConfigured = isSupabaseRestConfigured;
export const supabase = supabaseClient;
