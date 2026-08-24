import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';

import { SupabaseService } from '../supabase/supabase';
import { LocalRepository } from './local-repository';
import { Repository } from './repository';
import { SessionData } from './session-data';
import { SupabaseRepository } from './supabase-repository';

/**
 * Wires up durable storage.
 *
 * Supabase is the real target. The browser-storage adapter takes over only
 * when the project is still holding placeholder credentials, so the app is
 * usable — and a reload is non-destructive — before it is configured.
 *
 * Hydration runs as an app initializer, so the first screen renders with the
 * durable records already in place rather than flashing the seed and then
 * correcting itself. `SessionData` holds it back until Supabase has restored
 * the stored session — loading before that would ask Postgres for her rows
 * with no JWT, and RLS answers that with silence rather than an error.
 */
export function provideDataStore(): EnvironmentProviders {
  return makeEnvironmentProviders([
    SupabaseRepository,
    LocalRepository,
    {
      provide: Repository,
      useFactory: (): Repository =>
        inject(SupabaseService).isConfigured ? inject(SupabaseRepository) : inject(LocalRepository),
    },
    provideAppInitializer(() => inject(SessionData).start()),
  ]);
}
