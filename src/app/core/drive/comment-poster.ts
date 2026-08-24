import { Injectable, computed, inject, signal } from '@angular/core';

import { DataStore } from '../data/data-store';
import { Annotation, DocumentBlock, UUID } from '../models';
import { KIND_LABEL } from '../presentation/annotation-kind';
import { sectionsOf } from '../presentation/document-render';
import { DriveApi, DriveError } from './drive-api';
import { docsRange } from './docs-range';
import { markerChar, markerColour, markerNumber } from './markers';
import { DocsRange } from './drive-types';
import { extractDocument } from './docs-extract';
import { GoogleDriveAuth } from './google-auth';
import { locateQuote } from './quote-locator';

/**
 * Puts the teacher's comments on the student's Google Doc.
 *
 * Three rules shape everything here.
 *
 * **Only what she decided.** Accepted and rewritten comments go; dismissed ones
 * never do, and pending ones don't either. Sending is a deliberate act, not a
 * flush of whatever the model drafted.
 *
 * **Only once.** Each posted comment records its Drive id, so a second send
 * after further review carries only what is new. Nothing is ever posted twice
 * because a page was reloaded or a button pressed again.
 *
 * **Only where the words still are.** The document is re-read at send time and
 * every quote is looked up in the text as it stands. A comment whose sentence
 * the student has since rewritten is not posted at all — it is named in the
 * report instead, for her to place by hand.
 */

/** One comment that could not be placed, in terms she can act on. */
export interface UnplacedComment {
  id: UUID;
  quote: string;
  body: string;
}

export interface PostReport {
  posted: number;
  /** Already on the document from an earlier send. */
  skipped: number;
  unplaced: UnplacedComment[];
  /** True when Drive refused something — the banner carries the detail. */
  failed: boolean;
  /** Markers placed in the document this send. */
  markers: number;
  /**
   * Comments that got no marker because their span could not be located.
   *
   * Distinct from `unplaced`: those were not posted at all. These reached the
   * student — they simply have no number beside the sentence, because guessing
   * a position would put a number inside the wrong words.
   */
  unmarked: number;
  /**
   * Whether the comments anchored to the text or landed in the comments panel.
   *
   * Reported because the difference is the entire value of the feature to the
   * student: an anchored comment sits beside the sentence it is about, an
   * unanchored one is a list she has to match up herself. Not a failure — the
   * fallback is a working send — but not the same thing, and she should not
   * have to guess which she got.
   */
  anchored: boolean;
}

export type PostPhase = 'idle' | 'posting' | 'error' | 'done';

/**
 * Said when Drive itself refuses for scope.
 *
 * The pre-flight check asks the server which permissions the teacher granted,
 * and the server computes that from its own copy of the required list — so
 * between changing that list and deploying the functions that hold it, the
 * check passes and Drive refuses. Which is a stale deployment, not a state the
 * teacher can be expected to reason about. Catching the refusal itself means
 * the ask reaches her either way.
 */
const SCOPE_REFUSED =
  'גוגל סירבה להוסיף את ההערות, כי ההרשאה שיש כרגע היא לקריאה בלבד. צריך להתחבר מחדש לגוגל ולאשר את ההרשאה להוספת הערות.';

/**
 * Where the two upstream causes get said — the console, not her screen.
 *
 * Both sit above the app and neither is visible from inside it: the consent
 * screen can only offer a scope the Cloud project lists, and it can only ask
 * for one the deployed `drive-auth` puts in the URL. So "reconnect and
 * approve" can be a loop with no exit, and whoever is debugging needs to be
 * told why.
 *
 * But that person is not the teacher. She cannot redeploy a function or edit a
 * Cloud project, and printing instructions she cannot follow onto the screen
 * where she sends her students' feedback is noise at best. It goes where a
 * developer looks and nowhere else.
 */
const SCOPE_REFUSED_HINT =
  'Margin: Drive refused the comment for scope. If reconnecting does not change it, the consent screen is not offering the permission — check that https://www.googleapis.com/auth/drive is listed on the OAuth consent screen in Google Cloud, and that drive-auth has been redeployed since the scope list changed.';

/**
 * How the quoted sentence is carried, given that Drive cannot anchor it.
 *
 * The comment opens with the student's own words in quotation marks, so she can
 * find the place with a search even though the sidebar entry does not point at
 * it. `sectionsOf` supplies the heading it fell under when there is one, which
 * is the difference between "somewhere in twelve pages" and "in the methods
 * section".
 */
export function commentText(body: string, quote: string, section: string | null): string {
  const where = section ? `${section} · ` : '';
  return `${where}״${quote}״\n\n${body}`;
}

/**
 * A comment that names its own marker.
 *
 * The number is the anchoring mechanism, not decoration: the glyph in the text
 * and the number here are the only thing connecting a note in the panel to the
 * sentence it is about. The category name comes with it so the pair reads as
 * "① לשון" rather than as a bare figure.
 */
export function numberedCommentText(
  number: number | null,
  kindLabel: string,
  body: string,
  quote: string,
  section: string | null,
): string {
  const glyph = number === null ? null : markerChar(number);
  const head = glyph ? `${glyph} ${kindLabel}` : kindLabel;
  const where = section ? ` · ${section}` : '';
  return `${head}${where}\n״${quote}״\n\n${body}`;
}

@Injectable({ providedIn: 'root' })
export class CommentPoster {
  private readonly store = inject(DataStore);
  private readonly api = inject(DriveApi);
  private readonly auth = inject(GoogleDriveAuth);

  private readonly _phase = signal<PostPhase>('idle');
  private readonly _message = signal<string | null>(null);
  private readonly _report = signal<PostReport | null>(null);
  private readonly _needsReconnect = signal(false);

  readonly phase = this._phase.asReadonly();
  readonly message = this._message.asReadonly();
  readonly report = this._report.asReadonly();
  /** True once Drive has refused for scope — the screen offers the consent. */
  readonly needsReconnect = this._needsReconnect.asReadonly();
  readonly isPosting = computed(() => this._phase() === 'posting');

  /**
   * Comments on the current round that a send would carry.
   *
   * The round, not the submission: the document is re-read at send time, and a
   * comment left over from an earlier round quotes text that document no longer
   * contains. It would be looked up, refused, and reported as unplaceable —
   * which reads as a fault when it is simply an older round's work.
   */
  waiting(submissionId: UUID): Annotation[] {
    const roundId = this.store.roundFor(submissionId)?.id;
    if (!roundId) return [];

    return this.store
      .annotations()
      .filter(
        (a) =>
          a.round_id === roundId &&
          (a.status === 'accepted' || a.status === 'edited') &&
          !a.posted_comment_id,
      )
      .sort(
        (a, b) => a.anchor.block_index - b.anchor.block_index || a.anchor.start - b.anchor.start,
      );
  }

  async post(submissionId: UUID): Promise<PostReport | null> {
    if (this.isPosting()) return null;

    const submission = this.store.submission(submissionId);
    const fileId = submission?.drive_file_id;
    if (!submission || !fileId) {
      return this.fail('העבודה הזו לא הגיעה מהדרייב, אז אין מסמך להוסיף לו הערות.');
    }

    // Asked for before anything is attempted: a teacher who connected before
    // Margin could comment granted read-only, and Drive would answer with a
    // 403 that reads like a folder permission problem.
    if (this.auth.needsCommentConsent()) {
      return this.fail(this.auth.commentConsentMessage() ?? '');
    }

    const pending = this.waiting(submissionId);
    // This round's, like `waiting` — an earlier round's posted comments are on
    // the document too, but they are not what this send is reporting on.
    const roundId = this.store.roundFor(submissionId)?.id;
    const already = this.store
      .annotations()
      .filter(
        (a) =>
          a.round_id === roundId &&
          (a.status === 'accepted' || a.status === 'edited') &&
          !!a.posted_comment_id,
      ).length;

    if (!pending.length) {
      return this.fail(
        already
          ? 'כל ההערות שאישרת כבר נמצאות במסמך.'
          : 'אין הערות מאושרות לשלוח. אפשר לאשר הערות במסך הבדיקה.',
      );
    }

    this._phase.set('posting');
    this._message.set(null);
    this._report.set(null);
    this._needsReconnect.set(false);

    // The document as it is now, not as it was when it synced. This is the
    // whole basis for deciding what can safely be quoted.
    let blocks: readonly DocumentBlock[];
    let indices: number[][];
    try {
      const extracted = extractDocument(await this.api.getDocument(fileId));
      blocks = extracted.blocks;
      indices = extracted.indices;
    } catch (error) {
      return this.fail(
        error instanceof DriveError ? error.hebrew : 'לא הצלחתי לקרוא את המסמך מהדרייב.',
      );
    }

    const sectionTitle = this.sectionTitles(blocks);

    const unplaced: UnplacedComment[] = [];
    let posted = 0;
    let failed = false;
    let scopeRefused = false;
    /**
     * Whether the comments anchored. Decided once, by one call.
     *
     * Deliberately not a flag consulted inside each queued write: those run
     * concurrently, so every one of them would read "still trying" before the
     * first refusal came back, and an account outside the Developer Preview
     * would pay for a failed request per comment. One batch, one answer.
     */
    let anchoring = false;
    let markers = 0;
    let markerFailure: string | null = null;
    const plan: {
      annotation: Annotation;
      content: string;
      range: DocsRange | null;
      number: number | null;
    }[] = [];

    /**
     * Numbers already spent on this round, so a re-send continues rather than
     * repeating. Read from the records, not from a counter, because the last
     * send may have been on another device.
     */
    let highest = this.store
      .annotations()
      .filter((a) => a.round_id === roundId)
      .reduce((max, a) => Math.max(max, a.marker_number ?? 0), 0);

    const nextNumber = (): number | null => {
      const candidate = highest + 1;
      if (markerChar(candidate) === null) return null;
      highest = candidate;
      return candidate;
    };

    for (const annotation of pending) {
      const where = locateQuote(blocks, annotation.anchor);
      if (!where) {
        // The student rewrote it, or the sentence now appears twice and there
        // is no honest way to choose. Reported, never guessed at.
        unplaced.push({
          id: annotation.id,
          quote: annotation.anchor.quote,
          body: annotation.body,
        });
        continue;
      }

      const range = docsRange(indices, where);

      /**
       * The number this comment carries, and the marker that will carry it.
       *
       * An annotation that already has one keeps it: a re-send after further
       * review must not renumber what she has already sent, and must not put a
       * second glyph beside a sentence that has one. New ones continue from the
       * highest number this round has used, so numbers stay unique per round
       * even across several sends.
       */
      let number = annotation.marker_number;
      if (number === null && range) {
        const next = nextNumber();
        // Past fifty a marker would need more than one character, which the
        // write guard refuses on purpose. The comment still goes, unnumbered.
        if (next !== null) number = next;
      }

      const content = numberedCommentText(
        number,
        KIND_LABEL[annotation.kind],
        // Her final wording. `ai_body` is kept for the learning loop and is
        // never what a student reads.
        annotation.body,
        annotation.anchor.quote,
        sectionTitle.get(where.block_index) ?? null,
      );

      plan.push({ annotation, content, range, number });
    }

    /**
     * Anchored first, in one request.
     *
     * The Docs endpoint anchors to a real range; Drive's does not, and on a Doc
     * its stored anchor renders as "Original content deleted" — which reads to
     * a student as though her writing had been removed. Anchoring is in
     * Developer Preview, so an account not enrolled is refused: a reason to
     * fall back, not a lost write. The comments reach her either way and only
     * their placement differs, which is why the report says which she got.
     */
    const anchorable = plan.flatMap((item) =>
      item.range ? [{ annotation: item.annotation, content: item.content, range: item.range }] : [],
    );

    /**
     * The markers, before any comment is posted.
     *
     * Ordering matters twice over. Within the batch, insertions go back to
     * front so earlier positions stay where they were measured. Across the
     * send, the markers go first: a numbered comment whose glyph never made it
     * into the document points at nothing, whereas a glyph with no comment yet
     * is merely a number she is about to explain.
     */
    const marking = plan.flatMap((item) =>
      item.range && item.number !== null && item.annotation.marker_number === null
        ? [{ annotation: item.annotation, range: item.range, number: item.number }]
        : [],
    );

    if (marking.length) {
      try {
        await this.api.insertMarkers(
          fileId,
          marking.map((item) => ({
            index: item.range.startIndex,
            glyph: markerChar(item.number)!,
            colour: markerColour(item.annotation.kind),
          })),
        );
        for (const item of marking) {
          this.store.markAnnotationNumbered(item.annotation.id, item.number);
          markers += 1;
        }
      } catch (error) {
        if (error instanceof DriveError && error.kind === 'insufficient_scope') {
          scopeRefused = true;
          failed = true;
        } else {
          // The comments can still go; they simply carry no number in the text.
          markerFailure = error instanceof DriveError ? error.hebrew : String(error);
        }
      }
    }

    if (anchorable.length) {
      try {
        await this.api.insertAnchoredComments(fileId, anchorable);
        for (const item of anchorable) {
          // Docs returns no comment id, so this records that it went rather
          // than which comment it became — which is all the id was ever for.
          this.store.markAnnotationPosted(item.annotation.id, `docs:${item.range.startIndex}`);
          posted += 1;
        }
        anchoring = true;
      } catch (error) {
        // A refused *scope* is about the grant, not about the preview, and
        // quietly falling back would hide the one thing she can act on.
        if (error instanceof DriveError && error.kind === 'insufficient_scope') {
          scopeRefused = true;
          failed = true;
        }
      }
    }

    for (const item of plan) {
      // Anchored already, or refused for a reason no fallback can fix.
      if (this.store.annotation(item.annotation.id)?.posted_comment_id) continue;
      if (scopeRefused) break;

      const { annotation, content } = item;

      this.store.queueWrite(async () => {
        // Re-checked inside the unit, so a retry after a failed database write
        // records what Drive already accepted instead of posting it again.
        if (this.store.annotation(annotation.id)?.posted_comment_id) return;

        try {
          const comment = await this.api.createComment(fileId, content);
          if (!comment.id) throw new Error('Drive returned a comment with no id');
          this.store.markAnnotationPosted(annotation.id, comment.id);
          posted += 1;
        } catch (error) {
          failed = true;

          /**
           * A permission she has not granted is not unsaved work.
           *
           * Every other failure here is rethrown, so the store queues it and
           * "try again" genuinely re-posts. This one must not be: retrying
           * without the permission fails identically every time, so the queue
           * never empties and the banner returns on every attempt — saying work
           * will be lost when nothing is at risk. The comment is safely in the
           * database; only its trip to the document did not happen, and that
           * can be repeated whenever she likes.
           */
          if (error instanceof DriveError && error.kind === 'insufficient_scope') {
            scopeRefused = true;
            return;
          }

          // Rethrown on purpose: the store queues it for "try again" and
          // raises the banner, the same as any other write she would lose.
          throw error;
        }
      });
    }

    await this.store.settled();

    const report: PostReport = {
      posted,
      skipped: already,
      unplaced,
      failed,
      anchored: anchoring,
      markers,
      unmarked: plan.filter((item) => item.number === null).length,
    };
    this._report.set(report);
    this._phase.set(failed ? 'error' : 'done');
    this._needsReconnect.set(scopeRefused);
    this._message.set(scopeRefused ? SCOPE_REFUSED : markerFailure);
    if (scopeRefused) console.warn(SCOPE_REFUSED_HINT);
    return report;
  }

  /**
   * Takes every marker Margin put in this document back out.
   *
   * Two independent ways of knowing what is ours, and both must agree before a
   * character is deleted. The records say which numbers were placed; the
   * document is then re-read and each candidate index is checked to be holding
   * that exact glyph. A recorded position alone is not enough — the student may
   * have typed above it since, moving every index after — and a search alone is
   * not enough either, because it cannot tell Margin's glyph from one she
   * pasted herself.
   *
   * So: find the glyphs in the current text, keep only those whose number we
   * recorded, and delete precisely those. Anything that does not match both is
   * left exactly where it is.
   */
  async removeMarkers(submissionId: UUID): Promise<{ removed: number; failed: boolean } | null> {
    const submission = this.store.submission(submissionId);
    const fileId = submission?.drive_file_id;
    const roundId = this.store.roundFor(submissionId)?.id;
    if (!submission || !fileId || !roundId) return null;

    const ours = new Map<number, Annotation>();
    for (const annotation of this.store.annotations()) {
      if (annotation.round_id === roundId && annotation.marker_number !== null) {
        ours.set(annotation.marker_number, annotation);
      }
    }
    if (!ours.size) return { removed: 0, failed: false };

    this._phase.set('posting');
    this._message.set(null);

    let indices: number[][];
    let blocks: readonly DocumentBlock[];
    try {
      const extracted = extractDocument(await this.api.getDocument(fileId));
      blocks = extracted.blocks;
      indices = extracted.indices;
    } catch (error) {
      this._phase.set('error');
      this._message.set(
        error instanceof DriveError ? error.hebrew : 'לא הצלחתי לקרוא את המסמך מהדרייב.',
      );
      return null;
    }

    // Where each of our glyphs actually is now, read from the document.
    const found: { index: number; annotation: Annotation }[] = [];
    blocks.forEach((block, blockIndex) => {
      [...block.text].forEach((char, offset) => {
        const number = markerNumber(char);
        const annotation = number === null ? undefined : ours.get(number);
        const docIndex = indices[blockIndex]?.[offset];
        if (annotation && docIndex !== undefined && docIndex >= 0) {
          found.push({ index: docIndex, annotation });
        }
      });
    });

    if (!found.length) {
      this._phase.set('done');
      // The records say markers were placed and the document has none. She may
      // have deleted them herself; either way there is nothing to take out.
      for (const annotation of ours.values()) this.store.clearAnnotationMarker(annotation.id);
      return { removed: 0, failed: false };
    }

    let failed = false;
    this.store.queueWrite(async () => {
      try {
        await this.api.removeMarkers(
          fileId,
          found.map((f) => f.index),
        );
        for (const f of found) this.store.clearAnnotationMarker(f.annotation.id);
      } catch (error) {
        failed = true;
        throw error;
      }
    });

    await this.store.settled();
    this._phase.set(failed ? 'error' : 'done');
    return { removed: failed ? 0 : found.length, failed };
  }

  /** Clears the last outcome, so the next send starts from a clean panel. */
  dismiss() {
    this._phase.set('idle');
    this._message.set(null);
    this._report.set(null);
    this._needsReconnect.set(false);
  }

  /** Which heading each block sits under, for the comment's first line. */
  private sectionTitles(blocks: readonly DocumentBlock[]): Map<number, string> {
    const titles = new Map<number, string>();
    for (const section of sectionsOf(blocks)) {
      for (const index of section.block_indexes) titles.set(index, section.title);
    }
    return titles;
  }

  private fail(message: string): null {
    this._phase.set('error');
    this._message.set(message);
    this._report.set(null);
    return null;
  }
}
