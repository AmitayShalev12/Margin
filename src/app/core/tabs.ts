import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import { IconName } from '../shared/ui/icon/icon';
import { DataStore } from './data/data-store';
import { FEATURE_FLAGS } from './features';

/**
 * Open places, kept as tabs — the way Firefox keeps pages.
 *
 * A usability review asked for switching between parts of the app to be as
 * quick as switching browser tabs. Every place she goes opens a tab, or
 * re-activates the one already open there; each tab remembers exactly where
 * in that place she was. One tab per section, and one per student's paper, so
 * two reviews and the grading form can sit side by side.
 *
 * Remembered in this browser only: it is a convenience of hers, not a record.
 */

interface StoredTab {
  key: string;
  url: string;
  lastUsed: number;
}

export interface AppTab {
  key: string;
  url: string;
  title: string;
  icon: IconName;
  active: boolean;
}

const STORAGE_KEY = 'margin.tabs';
const MOVED_INSIDE_A_COURSE = ['home', 'submissions', 'grading-forms', 'style'];
/** Enough to hold a working afternoon; past it the oldest unused one goes. */
export const MAX_TABS = 8;

const SECTIONS: Record<string, { title: string; icon: IconName }> = {
  students: { title: 'התלמידות שלי', icon: 'users' },
  courses: { title: 'בית', icon: 'home' },
  settings: { title: 'הגדרות', icon: 'more' },
  approve: { title: 'אישור ושליחה', icon: 'mail' },
  review: { title: 'בדיקה', icon: 'docs' },
};

/**
 * Which tab a URL belongs to. Each paper under review is its own tab; every
 * other section has one, so returning to it brings back where she was.
 */
export function tabKey(url: string): string {
  const path = url.split(/[?#]/)[0];
  const [first, second] = path.split('/').filter(Boolean);
  if (!first || first === 'home') return 'courses';
  if (first === 'review' && second) return `review:${second}`;
  if (first === 'approve' && second) return `approve:${second}`;
  // Each student opens in a tab of her own.
  if (first === 'courses' && path.split('/').filter(Boolean)[2] === 'student') {
    return `student:${path.split('/').filter(Boolean)[3]}`;
  }
  // One tab per course; it remembers which part of the course she was in.
  if (first === 'courses' && second && second !== 'current') return `course:${second}`;
  return first;
}

@Injectable({ providedIn: 'root' })
export class Tabs {
  private readonly router = inject(Router);
  private readonly data = inject(DataStore);
  private readonly mailing = inject(FEATURE_FLAGS).mailing;

  private readonly stored = signal<StoredTab[]>(restore());
  private readonly activeKey = signal<string | null>(null);

  readonly tabs = computed<AppTab[]>(() =>
    this.stored().map((tab) => ({
      key: tab.key,
      url: tab.url,
      active: tab.key === this.activeKey(),
      ...this.describe(tab.key),
    })),
  );

  constructor() {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => this.visit((event as NavigationEnd).urlAfterRedirects));
  }

  /** Where she just arrived: its tab is updated, or opened. */
  visit(url: string) {
    const key = tabKey(url);
    const now = Date.now();

    this.stored.update((list) => {
      const existing = list.find((t) => t.key === key);
      if (existing) {
        return list.map((t) => (t.key === key ? { ...t, url, lastUsed: now } : t));
      }

      const next = [...list, { key, url, lastUsed: now }];
      if (next.length <= MAX_TABS) return next;

      // Over the cap: the tab she has not touched for longest goes — never
      // the one she is opening.
      const oldest = next
        .filter((t) => t.key !== key)
        .reduce((a, b) => (a.lastUsed <= b.lastUsed ? a : b));
      return next.filter((t) => t.key !== oldest.key);
    });

    this.activeKey.set(key);
    this.save();
  }

  /**
   * Closes a tab. Closing the one on screen moves to its neighbour, as a
   * browser does; closing the last one leaves her courses open.
   */
  close(key: string) {
    const list = this.stored();
    const index = list.findIndex((t) => t.key === key);
    if (index === -1) return;

    const remaining = list.filter((t) => t.key !== key);
    this.stored.set(remaining);
    this.save();

    if (key !== this.activeKey()) return;
    const neighbour = remaining[index] ?? remaining[index - 1];
    void this.router.navigateByUrl(neighbour ? neighbour.url : '/courses');
  }

  private describe(key: string): { title: string; icon: IconName } {
    if (key.startsWith('review:')) {
      const submission = this.data.submission(key.slice('review:'.length));
      const name = submission ? this.data.studentName(submission.student_id) : '';
      return { title: name || 'בדיקה', icon: 'docs' };
    }
    if (key.startsWith('student:')) {
      return { title: this.data.studentName(key.slice('student:'.length)) || 'תלמידה', icon: 'user' };
    }
    if (key.startsWith('course:')) {
      const course = this.data.courses().find((c) => c.id === key.slice('course:'.length));
      return { title: course?.name ?? 'קורס', icon: 'book' };
    }
    if (key.startsWith('approve:')) {
      const submission = this.data.submission(key.slice('approve:'.length));
      const name = submission ? this.data.studentName(submission.student_id) : '';
      return { title: name ? `אישור: ${name}` : 'אישור ושליחה', icon: 'mail' };
    }
    if (key === 'communication') {
      return this.mailing
        ? { title: 'מיילים', icon: 'mail' }
        : { title: 'ההערות במסמך', icon: 'docs' };
    }
    return SECTIONS[key] ?? { title: 'דף', icon: 'docs' };
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stored()));
    } catch {
      // Private windows and blocked storage: tabs simply start fresh next time.
    }
  }
}

function restore(): StoredTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is StoredTab =>
          !!t &&
          typeof t.key === 'string' &&
          typeof t.url === 'string' &&
          typeof t.lastUsed === 'number' &&
          // Places that moved inside a course, saved before they did.
          !MOVED_INSIDE_A_COURSE.includes(t.key),
      )
      .slice(0, MAX_TABS);
  } catch {
    return [];
  }
}
