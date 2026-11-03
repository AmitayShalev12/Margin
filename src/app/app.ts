import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { Assistant } from './core/assistant/assistant';
import { FEATURE_FLAGS } from './core/features';
import { QuickActionId, navGroups, navItems } from './core/navigation';
import { SupabaseService } from './core/supabase/supabase';
import { Tabs } from './core/tabs';
import { SignIn } from './features/sign-in/sign-in';
import { AddCourse } from './shared/ui/add-course/add-course';
import { AddStudent } from './shared/ui/add-student/add-student';
import { AssistantPanel } from './shared/ui/assistant-panel/assistant-panel';
import { CourseSwitcher } from './shared/ui/course-switcher/course-switcher';
import { Icon } from './shared/ui/icon/icon';
import { QuickActions } from './shared/ui/quick-actions/quick-actions';
import { SaveError } from './shared/ui/save-error/save-error';
import { TabStrip } from './shared/ui/tab-strip/tab-strip';

const RAIL_KEY = 'margin.rail-collapsed';
const GROUPS_KEY = 'margin.closed-groups';

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
    AssistantPanel,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly supabase = inject(SupabaseService);
  private readonly quick = inject(QuickActions);
  protected readonly assistant = inject(Assistant);

  protected readonly groups = navGroups(inject(FEATURE_FLAGS));
  protected readonly primaryNav = navItems(this.groups).filter((i) => i.primary);

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

  /** Groups she has folded away. */
  private readonly closedGroups = signal<ReadonlySet<string>>(new Set(readList(GROUPS_KEY)));

  constructor(router: Router) {
    // Created here so it is listening from the first navigation, not from
    // whenever the tab strip first renders.
    inject(Tabs);

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

  protected isGroupOpen(id: string): boolean {
    return !this.closedGroups().has(id);
  }

  protected toggleGroup(id: string) {
    const next = new Set(this.closedGroups());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.closedGroups.set(next);
    writeValue(GROUPS_KEY, JSON.stringify([...next]));
  }

  protected runQuick(id: QuickActionId) {
    this.moreOpen.set(false);
    if (id === 'add-student') this.quick.openAddStudent();
    else this.quick.openAddCourse();
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

function readList(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
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
