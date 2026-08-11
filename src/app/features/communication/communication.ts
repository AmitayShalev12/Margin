import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

@Component({
  selector: 'app-communication',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header title="מיילים לתלמידות" subtitle="מה נשלח, ומה עדיין ממתין לאישור שלך." />
      <app-placeholder-note
        phase="שלב 4"
        text="לכל סבב הערות ייווצר מייל מנוסח, עם שתיים-שלוש אפשרויות ניסוח לבחירה. שום דבר לא נשלח בלי שתאשרי."
      />
    </div>
  `,
})
export class Communication {}
