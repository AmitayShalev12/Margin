import { Injectable, computed, inject, signal } from '@angular/core';

import { DataStore } from '../data/data-store';
import { criterionKey, resolveScores, scoringMode } from '../grading/scoring';
import { newId } from '../ids';
import {
  Annotation,
  DocumentBlock,
  LearningFeedbackLog,
  Submission,
  SubmissionRound,
  UUID,
} from '../models';
import { FunctionError, TRANSPORT_MESSAGES, callFunction } from '../supabase/function-call';
import { SupabaseService } from '../supabase/supabase';
import { resolveAnnotations } from './anchor-resolver';
import { AnnotateRequest, AnnotateResponse, GENERATED_KINDS } from './contract';

export type GenerationPhase = 'idle' | 'generating' | 'error';

export interface GenerationState {
  phase: GenerationPhase;
  /** Hebrew, teacher-facing. */
  message: string | null;
  /** The raw failure, for the small print. Null when there is nothing to add. */
  detail: string | null;
  /** Comments whose quote didn't resolve — worth surfacing, not hiding. */
  discarded: number;
  /**
   * What the scoring half of the pass did, when the round was scored at all.
   *
   * Null when scoring was never asked for. Otherwise `returned` is how many
   * scores the model sent and `kept` how many survived matching against her
   * rubric — and the gap between them is the failure that is otherwise
   * completely silent. A model that answers with keys her form does not use
   * has every score dropped, and the screen is left exactly as it was, which
   * she can only read as the button not working.
   */
  scoring: { returned: number; kept: number; unmatched: string[] } | null;
}

const IDLE: GenerationState = {
  phase: 'idle',
  message: null,
  detail: null,
  discarded: 0,
  scoring: null,
};

/**
 * What the teacher is told when a batch fails, by the code the Edge Function
 * returned. Codes live server-side, wording lives here — the same split as
 * `DriveError`.
 *
 * `safety_blocked` matters more than it looks: SEL coursework legitimately
 * discusses distress, self-harm and family difficulty, and a content filter
 * will occasionally stop on it. She needs to know the document is fine and the
 * automatic pass isn't — not to be left wondering what she did wrong.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  safety_blocked:
    'חלק מהעבודה הזו לא עבר עיבוד אוטומטי. אין בזה כלום על העבודה עצמה — פשוט תעברי עליה ישירות.',
  rate_limited: 'יותר מדי בקשות ברצף. אפשר לנסות שוב עוד רגע.',
  daily_cap: 'נגמרה המכסה היומית של ניסוח ההערות. אפשר לנסות שוב מחר.',
  bad_response: 'התשובה שהתקבלה לא הייתה שלמה. אפשר לנסות שוב.',
  generation_failed: 'משהו השתבש בניסוח ההערות. אפשר לנסות שוב.',
  // Not a failure — it was slow. Worth saying so, because "try again" is the
  // right advice here and the wrong advice for most of the others.
  timed_out:
    'הניסוח לקח יותר מדי זמן והופסק. זה קורה בעבודות ארוכות — אפשר לנסות שוב, ובדרך כלל הפעם השנייה עוברת.',
};

const FALLBACK_MESSAGE = FAILURE_MESSAGES['generation_failed'];

/** Style examples and past decisions are the voice signal; more is better, but not unbounded. */
const MAX_STYLE_EXAMPLES = 40;
const MAX_STYLE_EDITS = 60;
/** Accepts and dismissals are weaker per record, so fewer of them earn their tokens. */
const MAX_STYLE_ACCEPTED = 30;
const MAX_STYLE_DISMISSED = 30;

/**
 * Drafts a round's inline comments.
 *
 * The model returns quotes; this resolves them against the round's own blocks
 * and discards anything that doesn't land exactly. What survives is written as
 * ordinary `Annotation` records through the store, so it persists by the same
 * path as a comment the teacher wrote herself.
 */
/**
 * What she is told when a drafting run fails.
 *
 * Exported because the quota half of it is worth testing on its own: "too many
 * requests" means one thing on her own key and another on a key shared with
 * everyone, and the difference decides what she does next — wait a minute, or
 * find out why the key she just saved is not being used. She hit exactly that
 * and the app could not tell her which.
 *
 * The key is named only where the quota is the subject. A safety block is not
 * about keys, and saying so there would be noise.
 */
export function failureMessage(error: unknown): string {
  const code = error instanceof FunctionError ? error.code : '';
  const base = FAILURE_MESSAGES[code] ?? TRANSPORT_MESSAGES[code] ?? FALLBACK_MESSAGE;

  if (code !== 'rate_limited' && code !== 'daily_cap') return base;

  const source = error instanceof FunctionError ? error.keySource : null;
  if (source === 'teacher') return `${base} הריצה רצה על המפתח שלך.`;
  if (source === 'shared') return `${base} הריצה רצה על המפתח המשותף, לא על מפתח משלך.`;

  // The function did not say. Better silent than guessing at which quota.
  return base;
}

@Injectable({ providedIn: 'root' })
export class AnnotationGenerator {
  private readonly store = inject(DataStore);
  private readonly supabase = inject(SupabaseService);

  private readonly _state = signal<GenerationState>(IDLE);
  readonly state = this._state.asReadonly();

  readonly isGenerating = computed(() => this._state().phase === 'generating');
  readonly canGenerate = this.supabase.isConfigured;

  /**
   * Generates a batch for one submission and stores it unconfirmed.
   *
   * The comments exist immediately but the round's `ai_summary_confirmed_at`
   * stays null — the review screen holds them behind the restatement until the
   * teacher has read it once. Confirming is `confirmBatch()`.
   */
  async generate(submissionId: UUID): Promise<{ created: number; discarded: number } | null> {
    if (this.isGenerating()) return null;

    const submission = this.store.submission(submissionId);
    const round = this.store.roundFor(submissionId);
    const blocks = round?.document_blocks;

    if (!submission || !round || !blocks?.length) {
      return this.fail('אין עדיין מסמך לנתח בעבודה הזו.');
    }
    if (!this.canGenerate) {
      return this.fail('צריך למלא את פרטי Supabase לפני שאפשר לנסח הערות.');
    }

    this._state.set({
      phase: 'generating',
      message: null,
      detail: null,
      discarded: 0,
      scoring: null,
    });

    const request = this.buildRequest(submission, round, blocks);
    if (!request) {
      return this.fail('צריך קורס ועבודה לפני שאפשר לנסח הערות.');
    }

    let response: AnnotateResponse;
    try {
      response = await callFunction<AnnotateResponse>(this.supabase, 'annotate', request);
    } catch (error) {
      return this.fail(
        failureMessage(error),
        error instanceof FunctionError ? error.detail : String(error),
      );
    }

    const { resolved, rejected } = resolveAnnotations(response.annotations ?? [], blocks);

    /**
     * The rubric scores, when the round carried any.
     *
     * Applied before the comments are written, so a failure here surfaces as a
     * save error rather than as a form that is silently a round behind. Scores
     * she has already settled are left alone inside the store.
     */
    /**
     * Recorded even when it is zero, and especially then. "The model returned
     * nothing" and "the model returned eleven scores and none of them matched
     * your rubric" are different problems with the same appearance on screen.
     */
    const returned = response.scores?.length ?? 0;
    let kept = 0;
    let unmatched: string[] = [];

    if (response.scores?.length) {
      const scored = resolveScores(
        this.store.gradingCategories().filter((c) => c.active),
        response.scores,
      );
      kept = scored.matched.length;
      unmatched = scored.unmatched;

      this.store.applyCriterionScores(
        submission.id,
        round.round_number,
        scored.matched.map((item) => ({
          categoryId: item.category.id,
          points: item.points,
          note: item.note,
        })),
      );
    }

    const now = new Date().toISOString();
    const annotations: Annotation[] = resolved.map((item, index) => ({
      id: newId(),
      submission_id: submission.id,
      round_id: round.id,
      anchor: item.anchor,
      kind: item.draft.kind,
      body: item.draft.body.trim(),
      // Kept from the start: the learning loop compares this against whatever
      // she edits it into, and there is no second chance to capture it.
      ai_body: item.draft.body.trim(),
      origin: 'ai',
      edited_by_teacher: false,
      status: 'pending',
      confidence: null,
      grading_category_id: null,
      resolved_in_round: null,
      sort_order: index,
      posted_comment_id: null,
      posted_at: null,
      marker_number: null,
      created_at: now,
      updated_at: now,
    }));

    /**
     * A pass that anchored nothing must not touch the round.
     *
     * `replaceDraftedAnnotations` clears the round's undecided drafts and puts
     * the new batch in their place, so calling it with nothing is a plain
     * delete — every comment still waiting for her would go, and nothing would
     * arrive. The screen would come back emptier with no error to explain it,
     * because nothing failed: a delete succeeded.
     */
    if (!annotations.length) {
      return this.fail(
        rejected.length
          ? `אף אחת מ־${rejected.length} ההערות שנוסחו לא נקשרה למקום מדויק בטקסט. מה שהיה כאן נשאר.`
          : 'לא נוסחו הערות לעבודה הזו. מה שהיה כאן נשאר.',
      );
    }

    this.store.replaceDraftedAnnotations(round.id, annotations);
    this.store.replaceRoundDocument(round.id, {
      ai_summary: response.summary?.trim() || null,
      ai_summary_confirmed_at: null,
    });
    this.store.setSubmissionStatus(submission.id, 'in_review');

    this._state.set({
      phase: 'idle',
      message: null,
      detail: null,
      discarded: rejected.length,
      // Null when the round was never up for scoring, so the screen can tell
      // "not asked" apart from "asked and got nothing back".
      scoring: request.scoring === 'scored' ? { returned, kept, unmatched } : null,
    });
    return { created: annotations.length, discarded: rejected.length };
  }

  /** The teacher has read the restatement; the batch becomes hers to work through. */
  confirmBatch(roundId: UUID) {
    this.store.replaceRoundDocument(roundId, {
      ai_summary_confirmed_at: new Date().toISOString(),
    });
  }

  /** She didn't recognise the pass — drop it rather than make her sift it. */
  discardBatch(roundId: UUID) {
    this.store.replaceDraftedAnnotations(roundId, []);
    this.store.replaceRoundDocument(roundId, {
      ai_summary: null,
      ai_summary_confirmed_at: null,
    });
  }

  // -- request assembly -----------------------------------------------------

  private buildRequest(
    submission: Submission,
    round: SubmissionRound,
    blocks: readonly DocumentBlock[],
  ): AnnotateRequest | null {
    const course = this.store.course();
    const assignment = this.store.assignment();
    // Nothing to draft against: the prompt is built out of the course's own
    // rules and the assignment's brief, and inventing either would put words
    // in her mouth that no teacher ever wrote.
    if (!course || !assignment) return null;

    // Decided here rather than in the prompt: whether a round may be scored is
    // her rule about the work, not a judgement about the text.
    const mode = scoringMode(round);

    return {
      allowed_kinds: [...GENERATED_KINDS],
      student_name: this.store.studentName(submission.student_id),
      round_number: round.round_number,
      course_name: course.name,
      assignment_title: assignment.title,
      assignment_brief: assignment.brief,
      blocks: blocks.map((b) => ({
        id: b.id,
        type: b.type,
        ...(b.level === undefined ? {} : { level: b.level }),
        text: b.text,
      })),
      rules: this.store
        .courseRules()
        .filter((r) => r.active)
        .map((r) => ({ kind: r.kind, body: r.body, origin: r.origin })),
      // A reference is a source now, and goes in the other field — sending it
      // in both would put the same authority in the prompt twice, once as
      // background and once as something to defer to.
      materials: this.store
        .courseMaterials()
        .filter((m) => m.active && m.kind !== 'reference')
        .map((m) => ({
          kind: m.kind,
          title: m.title,
          notes: m.notes,
          content: m.content,
        })),
      /**
       * The rubric the model may score, and the two things kept out of it.
       *
       * Criteria she alone judges are *absent* rather than flagged: a model
       * that cannot see 2.2 cannot score 2.2, whereas an instruction not to
       * score it is a request. And when the round is comments-only the list is
       * empty, so there is nothing to score against at all.
       */
      scoring: mode,
      rubric:
        mode === 'scored'
          ? this.store
              .gradingCategories()
              .filter((c) => c.active && !c.manual_only)
              .map((c) => ({
                key: criterionKey(c),
                name: c.name,
                section: c.section,
                max_points: c.max_points,
              }))
          : [],
      previous_scores:
        mode === 'scored'
          ? this.store
              .criterionScores(submission.id)
              .map((score) => {
                const category = this.store
                  .gradingCategories()
                  .find((c) => c.id === score.category_id);
                return category ? { key: criterionKey(category), points: score.points } : null;
              })
              .filter((entry): entry is { key: string; points: number | null } => !!entry)
          : [],
      sources: this.store.sources().map((s) => ({
        title: s.title,
        url: s.external_url,
        // Her own words about what to take from it, and the pasted text when
        // she gave one — both go through verbatim.
        notes: [s.notes, s.content].filter(Boolean).join('\n') || null,
      })),
      style_examples: this.store
        .styleExamples()
        .filter((e) => e.active)
        .slice(0, MAX_STYLE_EXAMPLES)
        .map((e) => ({
          source: e.source,
          student_text: e.student_text,
          teacher_text: e.teacher_text,
        })),
      // Newest first, throughout: her most recent decisions describe her voice
      // best, and the caps below cut the oldest rather than an arbitrary slice.
      style_edits: this.decisions('edited')
        .filter((l) => l.final_text)
        .slice(0, MAX_STYLE_EDITS)
        .map((l) => ({
          ai_text: l.ai_text,
          final_text: l.final_text as string,
          change_note: l.change_note,
          context_excerpt: l.context_excerpt,
        })),
      style_accepted: this.decisions('accepted')
        .slice(0, MAX_STYLE_ACCEPTED)
        .map((l) => ({ ai_text: l.ai_text, context_excerpt: l.context_excerpt })),
      style_dismissed: this.decisions('dismissed')
        .slice(0, MAX_STYLE_DISMISSED)
        .map((l) => ({ ai_text: l.ai_text, context_excerpt: l.context_excerpt })),
    };
  }

  /** Her decisions of one kind, newest first. */
  private decisions(action: LearningFeedbackLog['action']): LearningFeedbackLog[] {
    return this.store
      .feedbackLogs()
      .filter((l) => l.target_type === 'annotation' && l.action === action)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  private fail(message: string, detail: string | null = null): null {
    this._state.set({ phase: 'error', message, detail, discarded: 0, scoring: null });
    return null;
  }
}
