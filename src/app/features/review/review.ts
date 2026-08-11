import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PlaceholderNote } from '../../shared/ui/placeholder-note/placeholder-note';

/**
 * The core screen: the document itself with comments anchored inline.
 * `submissionId` is bound from the route via `withComponentInputBinding()`.
 */
@Component({
  selector: 'app-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, PlaceholderNote],
  template: `
    <div class="page">
      <app-page-header title="בדיקה" subtitle="המסמך עצמו, עם הערות בשוליים." />
      <app-placeholder-note
        phase="שלב 2"
        text="המסך המרכזי: קטעים מסומנים בתוך המסמך, עם הערה צמודה לכל אחד. במחשב — בועות בשוליים; בנייד — הקשה על סימון פותחת את ההערה מלמטה."
      />
    </div>
  `,
})
export class Review {
  /** Optional: the screen is reachable without an id while it is a stub. */
  readonly submissionId = input<string>('');
}
