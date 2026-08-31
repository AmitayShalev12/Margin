import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AnnotationGenerator } from '../../core/ai/annotation-generator';
import { DataStore } from '../../core/data/data-store';
import {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  DocumentBlock,
  TextAnchor,
  UUID,
} from '../../core/models';
import {
  ANNOTATION_STATE_LABEL,
  KIND_LABEL,
  LEGEND_KINDS,
  kindClass,
} from '../../core/presentation/annotation-kind';
import { renderBlock, sectionsOf } from '../../core/presentation/document-render';
import { SELECTION_REFUSAL, anchorFromSelection } from '../../core/presentation/selection-anchor';
import { submittedAt } from '../../core/presentation/submission-status';
import { Viewport } from '../../core/viewport';
import { BidiText } from '../../shared/ui/bidi-text/bidi-text';
import { ReliabilityPanel } from '../../shared/ui/reliability-panel/reliability-panel';

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
  /** Whether her decision on this one can still be taken back. */
  canUndo: boolean;
  /**
   * Already sent to the student's Drive.
   *
   * Undo restores what Margin holds; it cannot reach into her Drive and unsay
   * something. Said on the button rather than left to be discovered, because
   * the discovery would be a student having read a comment she withdrew.
   */
  wasPosted: boolean;
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
  imports: [RouterLink, BidiText, ReliabilityPanel],
  templateUrl: './review.html',
  styleUrl: './review.scss',
})
export class Review {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);
  protected readonly viewport = inject(Viewport);
  protected readonly generator = inject(AnnotationGenerator);

  readonly submissionId = input<string>('');

  protected readonly legend = LEGEND_KINDS.map((kind) => ({
    // Carried, not just rendered: the same list is the kind picker for a
    // comment she writes herself, and that needs the value behind the label.
    kind,
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

  /**
   * A comment to jump to, from a screen that lists notes away from the paper.
   *
   * Bound from `?comment=` by the router's component input binding. The grading
   * form and the email screen both show her own comments stripped of the
   * sentence that provoked them; getting back to the paper meant finding it by
   * eye, which for a seventeen-criterion form over forty comments is not a
   * thing anyone does twice.
   */
  readonly comment = input<string>();

  /** Briefly marked after a jump, so the eye lands on the right sentence. */
  protected readonly found = signal<string | null>(null);

  /**
   * Jumps once the comment actually exists on screen.
   *
   * The annotations arrive with the round rather than with the route, so
   * acting on the parameter the moment it appears would scroll to a paragraph
   * that has not been rendered yet.
   */
  private readonly jump = effect(() => {
    const id = this.comment();
    if (!id || this.found() === id) return;
    if (!this.live().some((a) => a.id === id)) return;

    this.reveal(id);
  });

  protected readonly roundNumber = computed(() => this.submission().current_round);

  protected readonly context = computed(() => {
    const where = [this.data.course()?.name, this.data.assignment()?.title]
      .filter(Boolean)
      .join(', ');
    return where ? `סבב ${this.roundNumber()} · ${where}` : `סבב ${this.roundNumber()}`;
  });

  /**
   * When this round arrived, to the minute.
   *
   * Shown for every round including the first: a paper handed in at 23:58 on
   * the night of a deadline and one handed in at 09:10 the next morning are
   * both "אתמול", and the difference is exactly what she is looking for.
   */
  protected readonly submittedAt = computed(() => submittedAt(this.round()?.received_at));

  protected readonly round = computed(() => this.data.roundFor(this.submission().id));

  /**
   * Comments on the round being read, that the teacher hasn't thrown away.
   *
   * Scoped to the round, not the submission. Everything else on this screen
   * already is — the document, the sections, the margin — and the mismatch had
   * a specific consequence: on a submission whose earlier round carried
   * comments, `hasComments()` was true while the list rendered nothing, because
   * those comments anchor to block ids belonging to the previous document. The
   * screen then showed the paper with no comments *and* no "draft me some",
   * because that button only appears when there are none. Every count on the
   * screen was describing a round the teacher wasn't looking at.
   */
  private readonly live = computed(() => {
    const roundId = this.round()?.id;
    if (!roundId) return [];
    return this.data
      .annotations()
      .filter((a) => a.round_id === roundId && a.status !== 'dismissed');
  });

  private readonly blocks = computed<readonly DocumentBlock[]>(
    () => this.round()?.document_blocks ?? [],
  );

  protected readonly hasComments = computed(() => this.live().length > 0);

  protected readonly hasDocument = computed(() => this.blocks().length > 0);

  /**
   * The drafted batch's restatement, shown once before she works through the
   * comments. Confirming it is what makes the batch hers.
   */
  protected readonly pendingSummary = computed(() => {
    const round = this.round();
    if (!round?.ai_summary || round.ai_summary_confirmed_at) return null;
    return round.ai_summary;
  });

  /** Counts per category, so the restatement can be checked against the batch. */
  protected readonly batchBreakdown = computed(() =>
    LEGEND_KINDS.map((kind) => ({
      label: KIND_LABEL[kind],
      class: kindClass(kind),
      count: this.live().filter((a) => a.kind === kind).length,
    })).filter((entry) => entry.count > 0),
  );

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
                stateClass: annotation ? this.stateClass(annotation) : '',
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

  /**
   * Opens the section, scrolls the sentence into view, and marks it.
   *
   * Deliberately the sentence in the paper rather than the comment card: the
   * question behind "take me to the comment" is *where in the work is this*,
   * and the card on its own answers the half she already had.
   *
   * Waits a frame because the section is opened in the same tick and the
   * paragraph is not in the DOM until the template has rendered it.
   */
  /**
   * From a comment to the sentence it is about.
   *
   * The other direction already existed — tapping a highlight in the paper
   * finds its comment. Going back was left to the eye, which on a paper long
   * enough to need forty comments is a scroll each time.
   */
  protected reveal(annotationId: string) {
    this.tapRun(annotationId);
    this.found.set(annotationId);

    requestAnimationFrame(() => {
      /**
       * The highlighted run, or the paragraph it sits in.
       *
       * A comment anchored to a heading has no run — headings are rendered
       * without them — so the run alone would leave that button doing nothing
       * at all, which is indistinguishable from broken.
       */
      const anchor = this.live().find((a) => a.id === annotationId)?.anchor;
      const target =
        document.querySelector(`[data-annotation="${annotationId}"]`) ??
        (anchor ? document.querySelector(`[data-block="${anchor.block_id}"]`) : null);

      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });

    // Long enough to find it, short enough not to become part of the page.
    setTimeout(() => {
      if (this.found() === annotationId) this.found.set(null);
    }, 4000);
  }

  // -- a comment of her own --------------------------------------------------
  //
  // Everything else on this screen began as a draft: the model proposed and
  // she accepted, edited or threw it away. A teacher reading a paper notices
  // things the model did not, and waiting for a draft that will never come —
  // or editing an unrelated comment into the one she meant — is not a thing
  // she should have to do.

  /** The span she selected and is writing about, once it anchors. */
  protected readonly composing = signal<TextAnchor | null>(null);
  protected readonly ownBody = signal('');
  protected readonly ownKind = signal<AnnotationKind>('language');
  protected readonly selectionError = signal<string | null>(null);

  /**
   * Reads what she selected in the paper.
   *
   * The offsets come from searching the block's own text rather than from the
   * DOM: the rendered paragraph is a row of spans with template whitespace
   * between them, and counting characters through it puts every anchor a few
   * positions out — invisibly, and only for some paragraphs.
   */
  protected captureSelection() {
    const selection = window.getSelection();
    const text = selection?.toString() ?? '';

    // A click with no drag is her reading, not writing. It clears nothing and
    // complains about nothing.
    if (!text.trim()) return;

    const node = selection?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const blockId = element?.closest('[data-block]')?.getAttribute('data-block') ?? null;

    const result = anchorFromSelection(this.blocks(), blockId, text);

    if (!result.ok) {
      this.composing.set(null);
      // `empty` and `no_block` are her clicking about the page; only a real
      // refusal earns a line of red.
      this.selectionError.set(
        result.reason === 'empty' || result.reason === 'no_block'
          ? null
          : SELECTION_REFUSAL[result.reason],
      );
      return;
    }

    this.selectionError.set(null);
    this.composing.set(result.anchor);
    this.ownBody.set('');
  }

  protected saveOwnComment() {
    const anchor = this.composing();
    const round = this.round();
    if (!anchor || !round) return;

    const written = this.data.addOwnAnnotation({
      submissionId: this.submission().id,
      roundId: round.id,
      anchor,
      kind: this.ownKind(),
      body: this.ownBody(),
    });

    if (!written) {
      this.selectionError.set('צריך לכתוב את ההערה.');
      return;
    }

    this.composing.set(null);
    this.ownBody.set('');
    this.selectionError.set(null);
    window.getSelection()?.removeAllRanges();

    // Shown landing. Without this the sentence simply acquires a faint tint at
    // the moment the selection disappears, which reads as nothing happening.
    this.reveal(written.id);
  }

  protected cancelOwnComment() {
    this.composing.set(null);
    this.ownBody.set('');
    this.selectionError.set(null);
    window.getSelection()?.removeAllRanges();
  }

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

  /**
   * Take back the last decision on a comment.
   *
   * Reveals it afterwards for the same reason saving one does: she needs to
   * see it land back among the undecided, or the button is indistinguishable
   * from one that did nothing.
   */
  protected undo(id: UUID) {
    this.data.undoDecision(id);
    this.sheetId.set(null);
    if (this.editingId() === id) this.editingId.set(null);
    this.reveal(id);
  }

  // -- drafting -------------------------------------------------------------

  protected async generate() {
    await this.generator.generate(this.submission().id);
  }

  /** She has read the restatement; the comments become hers to work through. */
  protected confirmBatch() {
    const round = this.round();
    if (round) this.generator.confirmBatch(round.id);
  }

  /** The pass was aimed wrong — drop it rather than make her sift it. */
  protected discardBatch() {
    const round = this.round();
    if (round) this.generator.discardBatch(round.id);
  }

  /**
   * The one primary action on the screen.
   *
   * It used to mark the submission `notes_sent` and return to the list, which
   * said the review had been sent when nothing had left the building. Now it
   * goes to the message itself: the draft, the wording, and the one place
   * anything is actually sent from.
   */
  protected send() {
    void this.router.navigate(['/communication', this.submission().id]);
  }

  // -- helpers --------------------------------------------------------------

  /**
   * How a marked span looks, by what has happened to its comment.
   *
   * `is-own` is not decoration. A drafted comment is loud while it waits for
   * her and recedes once she has dealt with it — she watched that happen. A
   * comment she wrote herself is `accepted` the moment it exists, so it would
   * otherwise appear straight into the quietest style, from nothing, with no
   * moment of it landing. Hers stays visible because she never sees it any
   * other way.
   */
  private stateClass(annotation: Annotation): string {
    if (annotation.status === 'resolved') return 'is-resolved';
    if (annotation.status === 'pending') return 'is-pending';
    return annotation.origin === 'teacher' ? 'is-own' : 'is-decided';
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
      canUndo: this.data.canUndo(a.id),
      wasPosted: !!a.posted_comment_id,
    };
  }
}
