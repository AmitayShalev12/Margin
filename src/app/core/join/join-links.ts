import { Injectable, inject, signal } from '@angular/core';

import { SupabaseService } from '../supabase/supabase';

export interface JoinLink {
  id: string;
  token: string;
  course_id: string;
  expires_at: string;
  max_submissions: number;
  submissions: number;
  closed_at: string | null;
  created_at: string;
}

export type JoinDuration = 'day' | 'week' | 'month' | 'date';

/** When a link made now for this long closes. */
export function expiryFor(duration: JoinDuration, date: string, now: Date = new Date()): Date | null {
  const days = { day: 1, week: 7, month: 30 } as const;
  if (duration !== 'date') return new Date(now.getTime() + days[duration] * 86_400_000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // Open until the end of the chosen day.
  const end = new Date(`${date}T23:59:59`);
  return end.getTime() > now.getTime() ? end : null;
}

export function isActive(link: JoinLink, now: Date = new Date()): boolean {
  return (
    !link.closed_at &&
    new Date(link.expires_at).getTime() > now.getTime() &&
    link.submissions < link.max_submissions
  );
}

/** Long enough that it cannot be guessed. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Her join links. Written straight to her own table: row-level security keeps
 * them hers, and the public side only ever goes through the `join` function.
 */
@Injectable({ providedIn: 'root' })
export class JoinLinks {
  private readonly supabase = inject(SupabaseService);

  readonly links = signal<JoinLink[]>([]);
  readonly error = signal<string | null>(null);

  readonly available = this.supabase.isConfigured;

  url(link: JoinLink): string {
    return `${window.location.origin}/join/${link.token}`;
  }

  async load(): Promise<void> {
    if (!this.available) return;
    const { data, error } = await this.supabase.client
      .from('join_links')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      this.error.set('לא הצלחתי לטעון את הקישורים.');
      return;
    }
    this.links.set((data ?? []) as JoinLink[]);
  }

  async create(courseId: string, expiresAt: Date): Promise<JoinLink | null> {
    const teacherId = this.supabase.teacherId;
    if (!this.available || !teacherId) return null;
    const row = {
      token: newToken(),
      teacher_id: teacherId,
      course_id: courseId,
      expires_at: expiresAt.toISOString(),
    };
    const { data, error } = await this.supabase.client.from('join_links').insert(row).select().single();
    if (error || !data) {
      this.error.set('לא הצלחתי ליצור את הקישור.');
      return null;
    }
    this.error.set(null);
    this.links.update((list) => [data as JoinLink, ...list]);
    return data as JoinLink;
  }

  async close(id: string): Promise<void> {
    const closedAt = new Date().toISOString();
    const { error } = await this.supabase.client
      .from('join_links')
      .update({ closed_at: closedAt })
      .eq('id', id);
    if (error) {
      this.error.set('לא הצלחתי לסגור את הקישור.');
      return;
    }
    this.links.update((list) => list.map((l) => (l.id === id ? { ...l, closed_at: closedAt } : l)));
  }
}
