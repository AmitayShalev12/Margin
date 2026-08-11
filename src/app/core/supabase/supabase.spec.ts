import { TestBed } from '@angular/core/testing';

import { SupabaseService } from './supabase';

describe('SupabaseService', () => {
  it('constructs with placeholder credentials without throwing', () => {
    const service = TestBed.inject(SupabaseService);

    expect(service.client).toBeTruthy();
    // The checked-in environment files still hold placeholders, so the app
    // must degrade to "not configured" rather than fail at startup.
    expect(service.isConfigured).toBe(false);
    expect(service.session()).toBeNull();
  });
});
