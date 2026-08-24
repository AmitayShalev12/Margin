import { Injectable, inject } from '@angular/core';

import { SupabaseService } from '../supabase/supabase';
import { DataStore } from './data-store';

/**
 * Ties the record store to who is signed in.
 *
 * This exists because the ordering is easy to get wrong and expensive when it
 * is. Hydration used to run as a plain app initializer, which fired before
 * Supabase had restored the stored session — so every select went out without
 * a JWT, RLS returned nothing, and the screens rendered the seeded
 * demonstration course looking exactly like a teacher with no work yet.
 *
 * So: wait for the session, load only when there is one, and clear everything
 * on sign-out.
 */
@Injectable({ providedIn: 'root' })
export class SessionData {
  private readonly supabase = inject(SupabaseService);
  private readonly store = inject(DataStore);

  /** Whatever load is currently in flight, so startup can wait on it. */
  private inFlight: Promise<void> = Promise.resolve();
  /** Who the in-flight or completed load was for. */
  private loadedFor: string | null = null;

  /** Runs once, as the app initializer. */
  async start(): Promise<void> {
    // Unconfigured checkout: the local adapter has no notion of a teacher, and
    // the app has to stay usable before credentials are filled in.
    if (!this.supabase.isConfigured) {
      await this.store.hydrate();
      return;
    }

    this.supabase.onTeacherChange((teacherId) => {
      if (teacherId) this.load(teacherId);
      else {
        this.loadedFor = null;
        this.store.reset();
      }
    });

    await this.supabase.ready;

    // Restoring a stored session fires the handler above; arriving signed out
    // does not. Either way there is nothing more to do once this settles.
    if (this.supabase.teacherId) this.load(this.supabase.teacherId);

    await this.inFlight;
  }

  /**
   * Loads once per teacher.
   *
   * Keyed on who rather than on `hydrated()`, which stays false for as long as
   * the first load is in flight — checking that instead would start a second
   * identical load whenever the restore and this method both fire.
   */
  private load(teacherId: string): void {
    if (this.loadedFor === teacherId) return;
    this.loadedFor = teacherId;
    this.inFlight = this.store.hydrate();
  }
}
