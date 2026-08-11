import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

@Component({
  selector: 'app-communication',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header
        title="מיילים לתלמידות"
        subtitle="טיוטה אחת, כמה ניסוחים, ושליחה רק באישורך."
      />
      <app-placeholder-note
        phase="שלב 4"
        text="המייל נכתב מתוך ההערות שאישרת, בסגנון שלך. שום דבר לא נשלח בלי שאישרת אותו."
      />
    </div>
  `,
})
export class Communication {}
