import { TopTools } from './shared/ui/top-tools/top-tools';
import { BackupService } from './core/backup/backup-service';
import { DataStore } from './core/data/data-store';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { Assistant } from './core/assistant/assistant';
import { MOBILE_NAV, RAIL_NAV } from './core/navigation';
import { SupabaseService } from './core/supabase/supabase';
import { Tabs } from './core/tabs';
import { SignIn } from './features/sign-in/sign-in';
import { AddCourse } from './shared/ui/add-course/add-course';
import { AddStudent } from './shared/ui/add-student/add-student';
import { AssistantPanel } from './shared/ui/assistant-panel/assistant-panel';
import { CourseSwitcher } from './shared/ui/course-switcher/course-switcher';
import { Icon } from './shared/ui/icon/icon';
import { SaveError } from './shared/ui/save-error/save-error';
import { TabStrip } from './shared/ui/tab-strip/tab-strip';

const RAIL_KEY = 'margin.rail-collapsed';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Icon,
    SignIn,
    SaveError,
    CourseSwitcher,
    TabStrip,
    AddStudent,
    AddCourse,
    AssistantPanel, TopTools],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly supabase = inject(SupabaseService);
  protected readonly assistant = inject(Assistant);

  protected readonly railNav = RAIL_NAV;
  protected readonly primaryNav = MOBILE_NAV;

  /**
   * The gate. Everything behind it reads and writes the teacher's own rows, so
   * there is no useful signed-out state to show — an unauthenticated session
   * gets silence from RLS, which would render as an empty account rather than
   * as a problem.
   *
   * An unconfigured checkout skips this entirely and runs on local records,
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

  /**
   * The sidebar folded to icons. Remembered in this browser: a preference of
   * hers about the screen, not a record.
   */
  protected readonly railCollapsed = signal(readFlag(RAIL_KEY));

  constructor(router: Router) {
    // Created here so it is listening from the first navigation, not from
    // whenever the tab strip first renders.
    inject(Tabs);

    // Once she is in and her work has loaded. It decides for itself whether a
    // copy is due, and it can only ever add a file to her own Drive.
    const backup = inject(BackupService);
    const data = inject(DataStore);
    effect(() => {
      if (data.hydrated() && this.supabase.user()) void backup.runAuto();
    });

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

  protected toggleRail() {
    this.railCollapsed.update((v) => !v);
    writeValue(RAIL_KEY, this.railCollapsed() ? '1' : '');
  }

  protected openAssistant() {
    this.moreOpen.set(false);
    this.assistant.open();
  }

  protected toggleMore() {
    this.moreOpen.update((open) => !open);
  }

  protected closeMore() {
    this.moreOpen.set(false);
  }
}

// Browser storage can be missing or refuse (private windows, blocked site
// data). Every read falls back to the default and every write is best-effort.

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}


function writeValue(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Remembered for this session only.
  }
}
