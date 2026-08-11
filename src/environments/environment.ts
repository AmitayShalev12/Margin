/**
 * Production environment.
 *
 * Replace the placeholders with the values from your Supabase project:
 *   Supabase dashboard → Project Settings → API
 *
 * The anon key is safe to ship in a browser bundle — row level security in
 * `supabase/migrations` is what actually protects the data.
 */
export const environment = {
  production: true,
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-SUPABASE-ANON-KEY',
};
