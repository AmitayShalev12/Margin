/**
 * Production environment.
 *
 * The anon key is safe to ship in a browser bundle — it is what the browser is
 * *meant* to hold, and row level security in `supabase/migrations` is what
 * actually protects the data. Nothing that grants real power lives here: the
 * Google refresh token and the model keys sit in Edge Function secrets and
 * never reach the client.
 *
 * These used to be placeholders, and the consequence was not an error but
 * something worse — `SupabaseService.isConfigured` reads false, which switches
 * the whole app into its unconfigured mode: the sign-in gate is skipped, every
 * screen renders, and nothing can be saved. A deployed build looked like a
 * working app with no way to sign in.
 */
export const environment = {
  production: true,
  supabaseUrl: 'https://cqmzcvaitiumnqyrttpe.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxbXpjdmFpdGl1bW5xeXJ0dHBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDM0OTAsImV4cCI6MjEwMjAxOTQ5MH0.JzMqk8TmKySSwYfGn88ONobqJtTaRvKMvFSVarr7RsQ',
};
