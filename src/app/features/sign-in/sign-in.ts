import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { SupabaseService } from '../../core/supabase/supabase';

type Phase = 'idle' | 'working' | 'sent';

/**
 * The way in.
 *
 * Google first, because she already has to grant Margin access to her Drive
 * with that same account — two credentials for one app is a thing to explain
 * and a thing to lose. The emailed link is the fallback for when Google is
 * unavailable, and it needs no password either: this is a teacher signing in
 * on her own laptop a few times a year, not an account she will log into
 * daily.
 *
 * Note that signing in here grants no Drive access. That is a separate consent
 * on the courses screen, and keeping them apart is deliberate — a long-lived
 * Drive grant should not ride along behind an ordinary sign-in button.
 */
@Component({
  selector: 'app-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.scss',
})
export class SignIn {
  private readonly supabase = inject(SupabaseService);

  protected readonly email = signal('');
  protected readonly phase = signal<Phase>('idle');
  protected readonly error = signal<string | null>(null);

  protected readonly busy = computed(() => this.phase() === 'working');
  protected readonly sent = computed(() => this.phase() === 'sent');

  protected readonly canSendLink = computed(() => /\S+@\S+\.\S+/.test(this.email().trim()));

  protected async withGoogle() {
    this.phase.set('working');
    this.error.set(null);

    const { error } = await this.supabase.signInWithGoogle();
    if (error) {
      this.phase.set('idle');
      this.error.set('לא הצלחתי להתחבר דרך Google. אפשר לנסות שוב, או לקבל קישור למייל.');
    }
    // On success the browser leaves for Google and comes back signed in;
    // there is nothing to do here.
  }

  protected async withLink() {
    if (!this.canSendLink()) return;

    this.phase.set('working');
    this.error.set(null);

    const { error } = await this.supabase.signInWithMagicLink(this.email());
    if (error) {
      this.phase.set('idle');
      this.error.set('לא הצלחתי לשלוח את הקישור. כדאי לבדוק את כתובת המייל ולנסות שוב.');
      return;
    }

    this.phase.set('sent');
  }
}
