import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

@Component({
  selector: 'app-grading-forms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header title="טפסי הערכה" subtitle="ההערות שסגרת, מסודרות לפי הקטגוריות שלך." />
      <app-placeholder-note
        phase="שלב 4"
        text="ההערות שנסגרו במהלך הבדיקה יתמלאו לתוך הטופס הפנימי שלך, לפי קטגוריות שנלמדו מהטפסים של השנים הקודמות. בסוף השנה ייגזר מכאן גם הטופס שהתלמידה מקבלת."
      />
    </div>
  `,
})
export class GradingForms {}
