import { TestBed } from '@angular/core/testing';

// The same specifier the service imports, so the test sees whichever
// environment file the build actually substituted.
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase';

describe('SupabaseService', () => {
  /**
   * This used to assert `isConfigured === false`, which was really asserting
   * that the repo ships with placeholder credentials — true until the project
   * was actually connected, and not a property worth pinning. What matters is
   * that the flag tracks the credentials, and that constructing never throws
   * either way: an unconfigured checkout has to boot into mock data rather
   * than fail at startup.
   */
  it('constructs whether or not credentials are filled in', () => {
    const service = TestBed.inject(SupabaseService);
    const placeholders =
      environment.supabaseUrl.includes('YOUR-') || environment.supabaseAnonKey.includes('YOUR-');

    expect(service.client).toBeTruthy();
    expect(service.isConfigured).toBe(!placeholders);
    expect(service.session()).toBeNull();
  });
});
