import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

@Component({
  selector: 'app-submissions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header title="עבודות" subtitle="כל מה שהוגש, לפי תלמידה." />
      <app-placeholder-note
        phase="שלב 2"
        text="רשימה פשוטה: שם התלמידה, שם הקובץ, ומצב בשפה רגילה. סינון ופרטי סנכרון יסתתרו מאחורי תפריט."
      />
    </div>
  `,
})
export class Submissions {}
