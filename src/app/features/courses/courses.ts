import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

@Component({
  selector: 'app-courses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header title="קורסים" subtitle="הכללים, הסילבוס והדוגמאות שעליהם הבדיקה נשענת." />
      <app-placeholder-note
        phase="שלב 2"
        text="לכל קורס: הכללים שלך, הסילבוס, עבודות לדוגמה, דוגמאות לתיקונים שכתבת, וכללים כלליים מהאינטרנט."
      />
    </div>
  `,
})
export class Courses {}
