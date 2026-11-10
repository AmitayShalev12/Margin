import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';

import { SupabaseService } from '../../core/supabase/supabase';

interface Field {
  key: string;
  label: string;
  required: boolean;
  type: string;
  dir?: 'ltr';
  placeholder?: string;
}

/** The college's columns. Required ones are marked; see `_shared/join.ts`. */
const FIELDS: Field[] = [
  { key: 'full_name', label: 'שם מלא', required: true, type: 'text' },
  { key: 'id_number', label: 'מספר זהות', required: false, type: 'text' },
  { key: 'mobile', label: 'טלפון נייד', required: true, type: 'tel', dir: 'ltr' },
  { key: 'phone', label: 'טלפון נוסף', required: false, type: 'tel', dir: 'ltr' },
  { key: 'email', label: 'דוא"ל', required: true, type: 'email', dir: 'ltr' },
  { key: 'address', label: 'כתובת', required: false, type: 'text' },
  { key: 'pedagogic_year', label: 'שנה פדגוגית', required: false, type: 'text' },
  { key: 'track', label: 'מסלול', required: false, type: 'text' },
  { key: 'department', label: 'חוג', required: false, type: 'text' },
  {
    key: 'folder_url',
    label: 'קישור לתיקייה שלך בגוגל דרייב',
    required: true,
    type: 'url',
    dir: 'ltr',
    placeholder: 'https://drive.google.com/drive/folders/…',
  },
];

/** The same rule as the server's `folderIdFromLink`: only a real Drive folder link. */
export function isFolderLink(value: string): boolean {
  const text = value.trim();
  return (
    /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]{10,}/.test(text) ||
    /^https:\/\/drive\.google\.com\/(?:open|folderview)\?(?:.*&)?id=[A-Za-z0-9_-]{10,}/.test(text)
  );
}

const SERVER_MESSAGES: Record<string, string> = {
  not_found: 'הקישור הזה לא קיים. כדאי לבקש מהמרצה קישור חדש.',
  closed: 'הקישור הזה כבר סגור. כדאי לבקש מהמרצה קישור חדש.',
  busy: 'הרבה נרשמות בבת אחת. אפשר לנסות שוב בעוד רגע.',
  invalid: 'יש שדות שצריך לתקן.',
};

/**
 * The public form behind a join link. No account, and nothing on it about the
 * teacher or other students: only the course name and the form.
 */
@Component({
  selector: 'app-join',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="join" dir="rtl">
      <p class="brand" dir="ltr">Margin</p>
      @switch (phase()) {
        @case ('loading') {
          <p class="note">רגע…</p>
        }
        @case ('closed') {
          <h1 class="title">ההרשמה לא זמינה</h1>
          <p class="note">{{ problem() }}</p>
        }
        @case ('done') {
          <h1 class="title">נרשמת לקורס {{ course() }}</h1>
          <p class="note">הפרטים והתיקייה שלך נשמרו. העבודות שתעלי לתיקייה יגיעו למרצה.</p>
        }
        @default {
          <h1 class="title">הצטרפות לקורס {{ course() }}</h1>
          <p class="note">שדות עם * הם חובה.</p>
          <form class="form" (submit)="$event.preventDefault(); submit()" novalidate>
            @for (field of fields; track field.key) {
              <label class="field">
                <span class="label">{{ field.label }}{{ field.required ? ' *' : '' }}</span>
                <input
                  class="control"
                  [type]="field.type"
                  [attr.dir]="field.dir ?? null"
                  [placeholder]="field.placeholder ?? ''"
                  [value]="values()[field.key] ?? ''"
                  (input)="set(field.key, $any($event.target).value)"
                />
                @if (errors()[field.key]; as error) {
                  <span class="error">{{ error }}</span>
                }
              </label>
            }
            @if (problem(); as text) {
              <p class="error" role="alert">{{ text }}</p>
            }
            <button type="submit" class="btn btn-primary" [disabled]="sending()">
              {{ sending() ? 'שולחת…' : 'הרשמה' }}
            </button>
          </form>
        }
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-block-size: 100dvh;
      background: var(--c-paper);
    }
    .join {
      max-inline-size: 34rem;
      margin-inline: auto;
      padding: var(--s-6) var(--s-4);
    }
    .brand {
      margin: 0 0 var(--s-4);
      font-family: var(--font-doc);
      font-weight: 700;
      text-align: end;
    }
    .title {
      font-size: var(--fs-xl);
    }
    .note {
      color: var(--c-ink-2);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--s-3);
      margin-block-start: var(--s-3);
    }
    .error {
      color: var(--c-danger);
      font-size: var(--fs-sm);
    }
  `,
})
export class Join {
  private readonly supabase = inject(SupabaseService);

  readonly token = input<string>('');

  protected readonly fields = FIELDS;
  protected readonly phase = signal<'loading' | 'form' | 'closed' | 'done'>('loading');
  protected readonly course = signal('');
  protected readonly values = signal<Record<string, string>>({});
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly problem = signal<string | null>(null);
  protected readonly sending = signal(false);

  constructor() {
    effect(() => {
      const token = this.token();
      untracked(() => void this.load(token));
    });
  }

  protected set(key: string, value: string) {
    this.values.update((all) => ({ ...all, [key]: value }));
    this.errors.update(({ [key]: _, ...rest }) => rest);
  }

  private async call(body: object): Promise<{ status: number; data: Record<string, unknown> }> {
    const response = await fetch(`${this.supabase.functionsUrl}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }

  private async load(token: string) {
    try {
      const { status, data } = await this.call({ action: 'info', token });
      if (status === 200 && typeof data['course'] === 'string') {
        this.course.set(data['course']);
        this.phase.set('form');
        return;
      }
      this.problem.set(SERVER_MESSAGES[String(data['error'])] ?? SERVER_MESSAGES['not_found']);
    } catch {
      this.problem.set('לא הצלחתי להתחבר. אפשר לנסות שוב מאוחר יותר.');
    }
    this.phase.set('closed');
  }

  /** Checked here for quick feedback; the server checks again and decides. */
  private check(): Record<string, string> {
    const values = this.values();
    const errors: Record<string, string> = {};
    for (const field of FIELDS) {
      if (field.required && !(values[field.key] ?? '').trim()) errors[field.key] = 'שדה חובה';
    }
    const email = (values['email'] ?? '').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors['email'] = 'כתובת לא תקינה';
    const id = (values['id_number'] ?? '').trim();
    if (id && !/^\d{5,9}$/.test(id)) errors['id_number'] = 'מספר זהות לא תקין';
    const folder = (values['folder_url'] ?? '').trim();
    if (folder && !isFolderLink(folder)) {
      errors['folder_url'] = 'צריך קישור לתיקייה בגוגל דרייב, שמתחיל ב־https://drive.google.com';
    }
    return errors;
  }

  protected async submit() {
    const errors = this.check();
    this.errors.set(errors);
    this.problem.set(null);
    if (Object.keys(errors).length) return;

    this.sending.set(true);
    try {
      const { status, data } = await this.call({
        action: 'submit',
        token: this.token(),
        fields: this.values(),
      });
      if (status === 200) {
        this.phase.set('done');
        return;
      }
      if (status === 404 || status === 410) {
        this.problem.set(SERVER_MESSAGES[String(data['error'])] ?? null);
        this.phase.set('closed');
        return;
      }
      const fieldErrors = (data['fields'] ?? {}) as Record<string, string>;
      this.errors.set(
        Object.fromEntries(Object.keys(fieldErrors).map((k) => [k, 'צריך לבדוק את השדה הזה'])),
      );
      this.problem.set(SERVER_MESSAGES[String(data['error'])] ?? 'ההרשמה לא הצליחה. אפשר לנסות שוב.');
    } catch {
      this.problem.set('לא הצלחתי לשלוח. אפשר לנסות שוב.');
    } finally {
      this.sending.set(false);
    }
  }
}
