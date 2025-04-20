import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

// Use SvelteKit's $env/static/public to access environment variables
const supabaseUrl = PUBLIC_SUPABASE_URL;
const supabaseAnonKey = PUBLIC_SUPABASE_ANON_KEY;

// Ensure the environment variables are loaded
// Note: SvelteKit's build process usually ensures these exist if defined in .env
// But a runtime check is still good practice.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL or Anon Key is missing from environment variables.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
