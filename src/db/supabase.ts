/**
 * Supabase client initialization
 * REQUIRED - API will not start without Supabase configuration
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  throw new Error(
    "Supabase configuration required. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables."
  );
}

// Initialize Supabase client (required)
const supabaseClient: SupabaseClient = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Test connection on startup
supabaseClient
  .from("projects")
  .select("id")
  .limit(1)
  .then(({ error }) => {
    if (error) {
      console.error("❌ Supabase connection error:", error.message);
      console.error(
        "   Please verify your Supabase credentials and that tables are created."
      );
      console.error(
        "   Run the migration SQL files in api/migrations/ to create tables."
      );
      process.exit(1);
    } else {
      console.log("✅ Supabase connected successfully");
    }
  })
  .catch((error) => {
    console.error("❌ Failed to connect to Supabase:", error.message);
    process.exit(1);
  });

export const supabase = supabaseClient;
