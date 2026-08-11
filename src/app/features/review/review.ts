import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { DataStore } from '../../core/data/data-store';
import { Annotation, AnnotationStatus, DocumentBlock, UUID } from '../../core/models';
import {
  ANNOTATION_STATE_LABEL,
  KIND_LABEL,
  LEGEND_KINDS,
  kindClass,
} from '../../core/presentation/annotation-kind';
import { renderBlock, sectionsOf } from '../../core/presentation/document-render';
import { Viewport } from '../../core/viewport';

/** A run of text as the template needs it, with its styling already decided. */
interface ViewRun {
  text: string;
  ltr: boolean;
  annotationId: UUID | null;
  kindClass: string;
  stateClass: string;
}

interface ViewBlock {
  id: string;
  isHeading: boolean;
  isTitle: boolean;
  text: string;
  runs: ViewRun[];
}

interface ViewComment {
  id: UUID;
  kindLabel: string;
  kindClass: string;
  stateLabel: string;
  quote: string;
  body: string;
  short: string;
  isPending: boolean;
  isResolved: boolean;
}

interface ViewSection {
  id: string;
  title: string;
  open: boolean;
  countText: string;
  comments: ViewComment[];
}

/** "12 הערות" — with the Hebrew singular and dual handled. */
function commentCount(n: number): string {
  if (n === 1) return 'הערה אחת';
  if (n === 2) return 'שתי הערות';
  return `${n} הערות`;
}

/**
 * The review screen: the submitted document with the teacher's comments
 * anchored inline, the way she would read them in a margin.
 *
 * Desktop puts the comments in a column beside the document; mobile has no
 * room for that, so tapping a highlight opens the comment in a bottom sheet
 * and the same comments are also listed under the document, grouped by
 * section and collapsed.
 */
@Component({
  selector: 'app-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './review.html',
  styleUrl: './review.scss',
})
export class Review {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);
  protected readonly viewport = inject(Viewport);

  readonly submissionId = input<string>('');

  protected readonly legend = LEGEND_KINDS.map((kind) => ({
    label: KIND_LABEL[kind],
    class: kindClass(kind),
  }));

  private readonly openSections = signal<Record<string, boolean>>({});
  protected readonly sheetId = signal<UUID | null>(null);
  protected readonly editingId = signal<UUID | null>(null);
  protected readonly draft = signal('');

  protected readonly submission = computed(
    () => this.data.submission(this.submissionId()) ?? this.data.submissions()[0],
  );

  protected readonly student = computed(() => this.data.studentName(this.submission().student_id));

  /** First name only — the send button reads better as "לנועה" than in full. */
  protected readonly firstName = computed(() => this.student().split(' ')[0]);

  protected readonly roundNumber = computed(() => this.submission().current_round);

  protected readonly context = computed(
    () => `סבב ${this.roundNumber()} · ${this.data.course().name}, ${this.data.assignment().title}`,
  );

  /** Comments on this submission that the teacher hasn't thrown away. */
  private readonly live = computed(() =>
    this.data
      .annotations()
      .filter((a) => a.submission_id === this.submission().id && a.status !== 'dismissed'),
  );

  private readonly blocks = computed<readonly DocumentBlock[]>(
    () => this.data.roundFor(this.submission().id)?.document_blocks ?? [],
  );

  protected readonly hasComments = computed(() => this.live().length > 0);

  protected readonly viewBlocks = computed<ViewBlock[]>(() => {
    const annotations = this.live();
    return this.blocks().map((block) => ({
      id: block.id,
      isHeading: block.type === 'heading',
      isTitle: block.type === 'heading' && (block.level ?? 1) === 1,
      text: block.text,
      runs:
        block.type === 'heading'
          ? []
          : renderBlock(block, annotations).map((run) => {
              const annotation = run.annotation_id
                ? annotations.find((a) => a.id === run.annotation_id)
                : undefined;
              return {
                text: run.text,
                ltr: run.ltr,
                annotationId: run.annotation_id,
                kindClass: annotation ? kindClass(annotation.kind) : '',
                stateClass: annotation ? this.stateClass(annotation.status) : '',
              };
            }),
    }));
  });

  /**
   * Comments grouped by the document's own sections. A seminar paper can
   * carry forty of these; arriving as one flat list would be unreadable.
   */
  protected readonly sections = computed<ViewSection[]>(() => {
    const open = this.openSections();
    const annotations = this.live();
    const blocks = this.blocks();

    const all = sectionsOf(blocks);
    const firstId = all[0]?.id;

    return all
      .map((section) => {
        const blockIds = new Set(
          section.block_indexes.map((i) => blocks[i]?.id).filter((id): id is string => !!id),
        );
        const comments = annotations
          .filter((a) => blockIds.has(a.anchor.block_id))
          .sort(
            (a, b) =>
              a.anchor.block_index - b.anchor.block_index || a.anchor.start - b.anchor.start,
          );
        const pending = comments.filter((c) => c.status === 'pending').length;

        return {
          id: section.id,
          title: section.title,
          // The first section is open by default; the rest wait to be asked.
          open: open[section.id] ?? section.id === firstId,
          countText:
            pending === 0
              ? 'הכול הוחלט'
              : pending === 1
                ? 'הערה אחת מחכה לך'
                : `${pending} הערות מחכות לך`,
          comments: comments.map((c) => this.toView(c)),
        };
      })
      .filter((section) => section.comments.length > 0);
  });

  protected readonly counterText = computed(() => {
    const total = this.live().length;
    const resolved = this.live().filter((a) => a.status === 'resolved').length;
    return `${commentCount(total)} · ${resolved === 1 ? 'אחת טופלה' : `${resolved} טופלו`}`;
  });

  private readonly pendingCount = computed(
    () => this.live().filter((a) => a.status === 'pending').length,
  );

  protected readonly sendHint = computed(() => {
    const n = this.pendingCount();
    if (n === 0) return 'כל ההערות מוכנות';
    if (n === 1) return 'הערה אחת עדיין מחכה להחלטה';
    return `${n} הערות עדיין מחכות להחלטה`;
  });

  protected readonly sheetComment = computed(() => {
    const id = this.sheetId();
    if (!id) return null;
    const annotation = this.live().find((a) => a.id === id);
    return annotation ? this.toView(annotation) : null;
  });

  // -- interaction ----------------------------------------------------------

  protected toggleSection(id: string) {
    const current = this.sections().find((s) => s.id === id)?.open ?? false;
    this.openSections.update((map) => ({ ...map, [id]: !current }));
  }

  /**
   * Tapping a highlight in the document. On mobile that opens the sheet; on
   * desktop the comment is already visible in the margin, so it just makes
   * sure its section is expanded.
   */
  protected tapRun(annotationId: UUID | null) {
    if (!annotationId) return;
    const section = this.sections().find((s) => s.comments.some((c) => c.id === annotationId));
    if (section) this.openSections.update((map) => ({ ...map, [section.id]: true }));
    if (!this.viewport.isDesktop()) this.sheetId.set(annotationId);
  }

  protected openSheet(id: UUID) {
    this.sheetId.set(id);
  }

  protected closeSheet() {
    this.sheetId.set(null);
  }

  protected decide(id: UUID, status: AnnotationStatus) {
    this.data.setAnnotationStatus(id, status);
    this.sheetId.set(null);
    if (this.editingId() === id) this.editingId.set(null);
  }

  protected startEdit(id: UUID) {
    const annotation = this.live().find((a) => a.id === id);
    if (!annotation) return;
    this.draft.set(annotation.body);
    // The sheet stays open on mobile — that is where the editor appears.
    this.editingId.set(id);
  }

  protected saveEdit(id: UUID) {
    const text = this.draft().trim();
    if (text) this.data.editAnnotation(id, text);
    this.editingId.set(null);
    this.sheetId.set(null);
  }

  protected cancelEdit() {
    this.editingId.set(null);
  }

  /** The one primary action on the screen. */
  protected send() {
    this.data.setSubmissionStatus(this.submission().id, 'notes_sent');
    void this.router.navigate(['/submissions']);
  }

  // -- helpers --------------------------------------------------------------

  private stateClass(status: AnnotationStatus): string {
    if (status === 'resolved') return 'is-resolved';
    return status === 'pending' ? 'is-pending' : 'is-decided';
  }

  private toView(a: Annotation): ViewComment {
    return {
      id: a.id,
      kindLabel: KIND_LABEL[a.kind],
      kindClass: kindClass(a.kind),
      stateLabel: ANNOTATION_STATE_LABEL[a.status],
      quote: a.anchor.quote,
      body: a.body,
      short: a.body.split(/[.?!]/)[0],
      isPending: a.status === 'pending',
      isResolved: a.status === 'resolved',
    };
  }
}
