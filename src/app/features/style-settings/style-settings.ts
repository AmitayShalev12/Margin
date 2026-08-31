import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { ModelKey } from '../../core/ai/model-key';
import { DataStore } from '../../core/data/data-store';
import { DocxError, ImportedComment, readDocxComments } from '../../core/import/docx-comments';
import { buildStyleProfile, countDecisions, deriveTraits } from '../../core/learning/style-profile';
import { kindClass } from '../../core/presentation/annotation-kind';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/**
 * "This is how the AI has learned your style."
 *
 * Reassurance first, configuration never: the screen shows what was learned
 * and from what, and offers two actions — add more examples, and take the
 * whole thing away with her.
 *
 * Every number and every observation here is computed from her own decisions.
 * Nothing is stated that the records cannot back, and when there isn't enough
 * yet the screen says so instead of filling the space.
 */
@Component({
  selector: 'app-style-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader],
  templateUrl: './style-settings.html',
  styleUrl: './style-settings.scss',
})
export class StyleSettings {
  private readonly data = inject(DataStore);

  // -- her own Gemini key ---------------------------------------------------
  //
  // Asked for so she can spend her own quota: the shared free-tier key runs
  // into a per-minute limit as soon as two papers are marked in a row, and a
  // rate limit she cannot do anything about reads as the app being broken.
  //
  // The key goes one way. It is typed here, sent once, and never comes back —
  // the screen only ever knows whether one is set and its last four
  // characters. An API key is a spending credential, and it is kept
  // server-side for the same reason the Drive refresh token is.

  protected readonly modelKey = inject(ModelKey);
  protected readonly keyDraft = signal('');
  protected readonly keyEditing = signal(false);
  protected readonly keySaved = signal(false);

  constructor() {
    // Asked once, when the screen appears, so it never claims "no key" before
    // it has looked. Not an effect: it depends on nothing and would only run
    // once anyway, and an effect that writes signals it never reads is a
    // puzzle for whoever reads it next.
    void this.modelKey.refresh();
  }

  protected startKeyEdit() {
    this.keyDraft.set('');
    this.keySaved.set(false);
    this.keyEditing.set(true);
  }

  protected cancelKeyEdit() {
    this.keyDraft.set('');
    this.keyEditing.set(false);
  }

  protected async saveKey() {
    if (!(await this.modelKey.save(this.keyDraft()))) return;

    // Cleared from memory the moment it is saved. Nothing on this screen has
    // any further use for it.
    this.keyDraft.set('');
    this.keyEditing.set(false);
    this.keySaved.set(true);
  }

  protected async clearKey() {
    this.keySaved.set(false);
    await this.modelKey.clear();
  }

  protected readonly counts = computed(() =>
    countDecisions(this.data.feedbackLogs(), this.data.styleExamples()),
  );

  protected readonly traits = computed(() =>
    deriveTraits(this.data.feedbackLogs(), this.data.annotations()).map((t) => ({
      text: t.text,
      evidence: t.evidence,
      class: kindClass(t.kind),
    })),
  );

  /** Counts come from the records themselves, never from a stored number. */
  protected readonly subtitle = computed(() => {
    const { edited, examples } = this.counts();
    if (edited === 0 && examples === 0) {
      return 'עוד לא למדתי ממך מספיק. כל הערה שתערכי או תוותרי עליה נספרת כאן.';
    }
    return `כך למדתי לכתוב כמוך — מתוך ${edited} הערות שערכת ו־${examples} דוגמאות שהוספת.`;
  });

  /** What she did with the drafts, in the order the review screen offers it. */
  protected readonly tally = computed(() => {
    const { accepted, edited, dismissed, emailEdits } = this.counts();
    return [
      { label: 'אישרת כמו שהן', value: accepted },
      { label: 'ערכת', value: edited },
      { label: 'ויתרת', value: dismissed },
      // Counted apart from the comments, and shown only once there is one —
      // a message she rewrote teaches a different thing from a comment she did.
      ...(emailEdits ? [{ label: 'מיילים שערכת', value: emailEdits }] : []),
    ];
  });

  protected readonly hasDecisions = computed(() => this.tally().some((entry) => entry.value > 0));

  /** The most recent rewrites, newest first. */
  protected readonly learned = computed(() =>
    this.data
      .feedbackLogs()
      .filter((l) => l.action === 'edited' && l.final_text)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 3)
      .map((l) => ({
        id: l.id,
        before: l.ai_text,
        after: l.final_text as string,
        note: l.change_note,
      })),
  );

  // -- her old marked-up papers ---------------------------------------------
  //
  // The button here used to do nothing. What it does now is read the comments
  // out of a Word document she marked up years ago — a decade of her voice
  // that would otherwise take a year to relearn one review at a time.

  protected readonly reading = signal(false);
  protected readonly importError = signal<string | null>(null);
  /** What was found in the file, waiting for her to confirm it is hers. */
  protected readonly found = signal<ImportedComment[]>([]);
  protected readonly authors = signal<{ name: string; count: number }[]>([]);
  /** Which authors she has ticked. Empty means she has not chosen yet. */
  protected readonly chosenAuthors = signal<Set<string>>(new Set());
  protected readonly imported = signal<number | null>(null);
  protected readonly fileName = signal<string | null>(null);

  /** The comments belonging to the authors she has ticked. */
  protected readonly selected = computed(() => {
    const authors = this.chosenAuthors();
    return this.found().filter((c) => authors.has(c.author));
  });

  /** A few, to show what is about to be learned rather than only how many. */
  protected readonly preview = computed(() => this.selected().slice(0, 4));

  protected async chooseFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared straight away so picking the same file twice still fires.
    input.value = '';
    if (!file) return;

    this.reading.set(true);
    this.importError.set(null);
    this.imported.set(null);
    this.found.set([]);
    this.authors.set([]);
    this.fileName.set(file.name);

    try {
      const { comments, authors } = await readDocxComments(await file.arrayBuffer());

      this.found.set(comments);
      this.authors.set(authors);
      // One author is not a choice; tick her and let the teacher press save.
      this.chosenAuthors.set(new Set(authors.length === 1 ? [authors[0].name] : []));

      if (!comments.length) {
        this.importError.set(
          'לא מצאתי הערות בקובץ הזה. יכול להיות שסימנת על נייר, או שזה קובץ אחר.',
        );
      }
    } catch (error) {
      this.importError.set(error instanceof DocxError ? error.hebrew : 'לא הצלחתי לקרוא את הקובץ.');
    } finally {
      this.reading.set(false);
    }
  }

  protected toggleAuthor(name: string) {
    this.chosenAuthors.update((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  protected isChosen(name: string): boolean {
    return this.chosenAuthors().has(name);
  }

  /** She has said which comments are hers. Only those are learned from. */
  protected save() {
    const added = this.data.importStyleExamples(
      this.selected().map((c) => ({ quote: c.quote, body: c.body })),
    );

    this.imported.set(added);
    this.found.set([]);
    this.authors.set([]);
    this.chosenAuthors.set(new Set());
  }

  protected discard() {
    this.found.set([]);
    this.authors.set([]);
    this.chosenAuthors.set(new Set());
    this.importError.set(null);
    this.fileName.set(null);
  }

  // -- the authorities she defers to ----------------------------------------

  protected readonly sources = computed(() => this.data.sources());
  protected readonly sourceTitle = signal('');
  protected readonly sourceUrl = signal('');
  protected readonly sourceNotes = signal('');
  protected readonly sourceError = signal<string | null>(null);
  protected readonly addingSource = signal(false);

  protected openSourceForm() {
    this.addingSource.set(true);
    this.sourceError.set(null);
  }

  protected addSource() {
    const added = this.data.addSource(this.sourceTitle(), this.sourceUrl(), this.sourceNotes());
    if (!added) {
      this.sourceError.set('צריך שם למקור, וקורס פתוח לשייך אליו.');
      return;
    }

    this.sourceError.set(null);
    this.sourceTitle.set('');
    this.sourceUrl.set('');
    this.sourceNotes.set('');
    this.addingSource.set(false);
  }

  protected removeSource(id: string) {
    this.data.setSourceActive(id, false);
  }

  /**
   * Hands the learned style over as a file.
   *
   * The point is that it is hers: readable JSON, named fields, no ids — if she
   * stops using Margin the pairs she spent a year producing are still hers to
   * read and to take somewhere else.
   */
  protected exportProfile() {
    const profile = buildStyleProfile({
      logs: this.data.feedbackLogs(),
      examples: this.data.styleExamples(),
      annotations: this.data.annotations(),
      exportedAt: new Date().toISOString(),
    });

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `margin-style-${profile.exported_at.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
