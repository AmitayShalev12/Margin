import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { NAV_ITEMS, PRIMARY_NAV, SECONDARY_NAV } from './core/navigation';
import { SupabaseService } from './core/supabase/supabase';
import { SignIn } from './features/sign-in/sign-in';
import { Icon } from './shared/ui/icon/icon';
import { SaveError } from './shared/ui/save-error/save-error';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, SignIn, SaveError],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly supabase = inject(SupabaseService);

  protected readonly navItems = NAV_ITEMS;
  protected readonly primaryNav = PRIMARY_NAV;
  protected readonly secondaryNav = SECONDARY_NAV;

  /**
   * The gate. Everything behind it reads and writes the teacher's own rows, so
   * there is no useful signed-out state to show — an unauthenticated session
   * gets silence from RLS, which would render as an empty account rather than
   * as a problem.
   *
   * An unconfigured checkout skips this entirely and runs on seeded records,
   * so the app stays openable before credentials are filled in.
   */
  protected readonly needsSignIn = computed(
    () => this.supabase.isConfigured && !this.supabase.loading() && !this.supabase.session(),
  );

  protected readonly checkingSession = computed(
    () => this.supabase.isConfigured && this.supabase.loading(),
  );

  /** The "עוד" sheet on mobile — four tabs is all that fits comfortably. */
  protected readonly moreOpen = signal(false);

  constructor(router: Router) {
    router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.moreOpen.set(false));
  }

  /** Shown beside the sign-out control, so she can see which account this is. */
  protected readonly signedInAs = computed(() => this.supabase.user()?.email ?? null);

  protected async signOut() {
    await this.supabase.signOut();
    // `onTeacherChange` clears the store; the gate above swaps in the sign-in
    // screen on its own.
  }

  protected toggleMore() {
    this.moreOpen.update((open) => !open);
  }

  protected closeMore() {
    this.moreOpen.set(false);
  }
}
