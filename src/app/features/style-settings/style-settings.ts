import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

@Component({
  selector: 'app-style-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header title="הסגנון שלי" subtitle="כך המערכת למדה לכתוב כמוך." />
      <app-placeholder-note
        phase="שלב 2"
        text="דוגמאות מהכתיבה שלך, ומה שנלמד מכל תיקון שעשית להערה מוצעת. פעולה אחת ברורה: להוסיף דוגמאות."
      />
    </div>
  `,
})
export class StyleSettings {}
