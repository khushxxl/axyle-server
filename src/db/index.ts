/**
 * Database/storage initialization
 * REQUIRES Supabase - no fallback to in-memory storage
 */

import { supabase } from "./supabase";
import { SupabaseStorage } from "./supabaseStorage";
import { StorageAdapter } from "./storage";
import { config } from "../config";

if (!supabase || !config.supabase.url || !config.supabase.serviceRoleKey) {
  console.error("❌ Supabase configuration required!");
  console.error("   Please set the following environment variables:");
  console.error("   - SUPABASE_URL");
  console.error("   - SUPABASE_SERVICE_ROLE_KEY");
  console.error("   - SUPABASE_ANON_KEY (optional but recommended)");
  console.error("");
  console.error("   The API requires Supabase for persistent storage.");
  console.error(
    "   Get your keys from: https://supabase.com/dashboard/project/_/settings/api",
  );
  process.exit(1);
}

// Initialize Supabase storage (required)
const storage: StorageAdapter = new SupabaseStorage(supabase);
console.log("📦 Using Supabase for persistent storage");

export { storage };
export type { StorageAdapter };
