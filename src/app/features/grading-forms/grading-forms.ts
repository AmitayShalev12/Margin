import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

@Component({
  selector: 'app-grading-forms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header title="טפסי הערכה" subtitle="הטופס הפנימי שלך, והטופס שהתלמידה מקבלת." />
      <app-placeholder-note
        phase="שלב 4"
        text="הקטגוריות נבנות מהקטגוריות שחזרו אצלך בשנים קודמות, וכל הערה שאישרת בבדיקה נכנסת לקטגוריה שלה מעצמה."
      />
    </div>
  `,
})
export class GradingForms {}
