import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header title="מה ממתין לי" subtitle="העבודות שדורשות את תשומת ליבך עכשיו." />
      <app-placeholder-note
        phase="שלב 2"
        text="כאן תופיע רשימה קצרה של העבודות שממתינות לך — ותו לא. סטטיסטיקות והיסטוריה יהיו במרחק הקשה אחת."
      />
    </div>
  `,
})
export class Dashboard {}
