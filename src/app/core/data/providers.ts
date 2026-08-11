import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';

import { SupabaseService } from '../supabase/supabase';
import { DataStore } from './data-store';
import { LocalRepository } from './local-repository';
import { Repository } from './repository';
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
 * correcting itself.
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
    provideAppInitializer(() => inject(DataStore).hydrate()),
  ]);
}
