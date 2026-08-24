import { Injectable, computed, inject, signal } from '@angular/core';

import { DataStore } from '../data/data-store';
import { derivedId } from '../ids';
import {
  Annotation,
  LearningFeedbackLog,
  StudentEmail,
  StudentEmailVariant,
  UUID,
} from '../models';
import { FunctionError, TRANSPORT_MESSAGES, callFunction } from '../supabase/function-call';
import { SupabaseService } from '../supabase/supabase';
import { EmailRequest, EmailResponse, VARIANT_BRIEFS } from './contract';

/**
 * Drafts the message that carries a round of comments back to the student.
 *
 * Three options in one call, all three built from the comments she actually
 * stood behind — accepted, rewritten, or marked as dealt with. Pending drafts
 * are not in it: a comment she has not decided about is not something to tell a
 * student about.
 *
 * The voice comes from the same two places the annotations and the grading form
 * draw on, plus one more that only exists here: her rewrites of past emails.
 * That last one is handed to the model as the specification rather than as
 * background, because it is the only record of how she writes *to* a girl
 * rather than *about* a sentence.
 */

export type GenerationPhase = 'idle' | 'generating' | 'error';

const FAILURE_MESSAGES: Record<string, string> = {
  safety_blocked: 'המייל הזה לא עבר עיבוד אוטומטי. אפשר לכתוב אותו ידנית.',
  rate_limited: 'יותר מדי בקשות ברצף. אפשר לנסות שוב עוד רגע.',
  daily_cap: 'נגמרה המכסה היומית של הניסוח. אפשר לנסות שוב מחר.',
  bad_response: 'התשובה שהתקבלה לא הייתה שלמה. אפשר לנסות שוב.',
  no_comments: 'אין עדיין הערות שאישרת בעבודה הזו, ואין על מה לכתוב.',
  not_signed_in: 'ההתחברות פגה. צריך להתחבר שוב.',
  generation_failed: 'משהו השתבש בניסוח המייל. אפשר לנסות שוב.',
};

/** Her voice, at both scales. Enough to show the pattern, not the whole year. */
const MAX_STYLE_EXAMPLES = 30;
const MAX_COMMENT_EDITS = 30;
/** Fewer, because each one is a whole message and they carry the most weight. */
const MAX_EMAIL_EDITS = 8;

/** The comments a message is written from: the ones she decided to keep. */
export function standsBehind(
  annotations: readonly Annotation[],
  submissionId: UUID,
  roundId: UUID | null,
): Annotation[] {
  return annotations
    .filter(
      (a) =>
        a.submission_id === submissionId &&
        (!roundId || a.round_id === roundId) &&
        (a.status === 'accepted' || a.status === 'edited' || a.status === 'resolved'),
    )
    .sort((a, b) => a.anchor.block_index - b.anchor.block_index || a.anchor.start - b.anchor.start);
}

@Injectable({ providedIn: 'root' })
export class EmailGenerator {
  private readonly store = inject(DataStore);
  private readonly supabase = inject(SupabaseService);

  private readonly _phase = signal<GenerationPhase>('idle');
  private readonly _message = signal<string | null>(null);
  private readonly _detail = signal<string | null>(null);

  readonly phase = this._phase.asReadonly();
  readonly message = this._message.asReadonly();
  /** The raw failure, for the small print. Null when there is nothing to add. */
  readonly detail = this._detail.asReadonly();
  readonly isGenerating = computed(() => this._phase() === 'generating');

  /**
   * Drafts (or re-drafts) the message for one submission.
   *
   * Re-drafting replaces the *options* and never her text. If she has already
   * rewritten the message, that rewrite stays exactly as it is and the new
   * options sit beside it — the same rule `replaceDraftedAnnotations` arrived
   * at, for the same reason: a second pass must not be able to destroy work she
   * has done without saying so.
   */
  async generate(submissionId: UUID): Promise<StudentEmail | null> {
    if (this.isGenerating()) return null;

    const submission = this.store.submission(submissionId);
    if (!submission) return this.fail(FAILURE_MESSAGES['generation_failed']);

    const existing = this.store.studentEmail(submissionId);
    if (existing?.status === 'sent') {
      return this.fail('המייל הזה כבר נשלח. אפשר לפתוח סבב חדש.');
    }

    const round = this.store.roundFor(submissionId);
    const comments = standsBehind(this.store.annotations(), submissionId, round?.id ?? null);
    if (!comments.length) return this.fail(FAILURE_MESSAGES['no_comments']);

    if (!this.supabase.isConfigured) {
      return this.fail('צריך למלא את פרטי Supabase לפני שאפשר לנסח מיילים.');
    }

    this._phase.set('generating');
    this._message.set(null);
    this._detail.set(null);

    let response: EmailResponse;
    try {
      response = await callFunction<EmailResponse>(
        this.supabase,
        'student-email',
        this.buildRequest(submissionId, comments),
      );
    } catch (error) {
      return this.failFrom(error);
    }

    const variants = this.toVariants(response);
    if (!variants.length) return this.fail(FAILURE_MESSAGES['bad_response']);

    // Her rewrite survives a re-draft; an untouched draft adopts the first
    // option so there is always something on screen to read.
    const keepsHerText = existing?.edited_by_teacher === true;
    const chosen = variants.find((v) => v.key === existing?.selected_variant_key) ?? variants[0];

    const now = new Date().toISOString();
    const email: StudentEmail = {
      // Derived, not random: one message per round, so re-drafting on a second
      // device updates the row rather than opening a rival draft.
      id: derivedId('student-email', `${submissionId}:${round?.id ?? 'no-round'}`),
      submission_id: submissionId,
      student_id: submission.student_id,
      round_id: round?.id ?? null,
      subject: keepsHerText ? (existing?.subject ?? chosen.subject) : chosen.subject,
      body: keepsHerText ? (existing?.body ?? chosen.body) : chosen.body,
      variants,
      selected_variant_key: keepsHerText ? (existing?.selected_variant_key ?? null) : chosen.key,
      ai_body: keepsHerText ? (existing?.ai_body ?? null) : chosen.body,
      edited_by_teacher: keepsHerText,
      status: 'draft',
      sent_at: null,
      error_message: null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    this.store.saveStudentEmail(email);
    this._phase.set('idle');
    return email;
  }

  // -- request assembly -----------------------------------------------------

  private buildRequest(submissionId: UUID, comments: readonly Annotation[]): EmailRequest {
    const submission = this.store.submission(submissionId)!;
    const round = this.store.roundFor(submissionId);
    const name = this.store.studentName(submission.student_id);

    return {
      student_name: name,
      first_name: name.split(' ')[0],
      course_name: this.store.course()?.name ?? '',
      assignment_title: this.store.assignment()?.title ?? '',
      round_number: round?.round_number ?? submission.current_round,
      // Only a restatement she confirmed. An unconfirmed one is the model's
      // account of the batch, not hers, and would be laundered into her voice.
      summary: round?.ai_summary_confirmed_at ? (round.ai_summary ?? null) : null,
      comments: comments.map((a) => ({
        kind: a.kind,
        body: a.body,
        quote: a.anchor.quote,
      })),
      variants: [...VARIANT_BRIEFS],
      style_examples: this.store
        .styleExamples()
        .filter((e) => e.active)
        .slice(0, MAX_STYLE_EXAMPLES)
        .map((e) => ({
          source: e.source,
          student_text: e.student_text,
          teacher_text: e.teacher_text,
        })),
      style_edits: this.edits('annotation').slice(0, MAX_COMMENT_EDITS),
      email_edits: this.edits('student_email').slice(0, MAX_EMAIL_EDITS),
    };
  }

  /** Her rewrites of one kind of drafted text, newest first. */
  private edits(
    target: LearningFeedbackLog['target_type'],
  ): { ai_text: string; final_text: string; change_note: string | null }[] {
    return this.store
      .feedbackLogs()
      .filter((l) => l.target_type === target && l.action === 'edited' && !!l.final_text)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((l) => ({
        ai_text: l.ai_text,
        final_text: l.final_text as string,
        change_note: l.change_note,
      }));
  }

  /**
   * The model's options, labelled here rather than by it.
   *
   * Anything it returns under a key we didn't ask for is dropped, and the label
   * on the chip is always ours — so a model that renames "קצר" cannot rename
   * what she is choosing between.
   */
  private toVariants(response: EmailResponse): StudentEmailVariant[] {
    const seen = new Set<string>();

    return (response.variants ?? [])
      .filter((v) => v?.body?.trim())
      .flatMap((v) => {
        const brief = VARIANT_BRIEFS.find((b) => b.key === v.key);
        if (!brief || seen.has(brief.key)) return [];
        seen.add(brief.key);
        return [
          {
            key: brief.key,
            label: brief.label,
            subject: v.subject?.trim() || (this.store.assignment()?.title ?? ''),
            body: v.body.trim(),
          },
        ];
      });
  }

  /**
   * Turns a failed call into something she can act on.
   *
   * Domain wording first — a safety block or the daily cap is about this
   * request. Otherwise the transport wording, which names the causes that have
   * nothing to do with the work: a function never deployed, a key never set, a
   * session that expired. The raw line is kept alongside either way.
   */
  private failFrom(error: unknown): null {
    const code = error instanceof FunctionError ? error.code : '';
    const message =
      FAILURE_MESSAGES[code] ?? TRANSPORT_MESSAGES[code] ?? FAILURE_MESSAGES['generation_failed'];

    this._detail.set(error instanceof FunctionError ? error.detail : String(error));
    return this.fail(message, this._detail());
  }

  private fail(message: string, detail: string | null = null): null {
    this._phase.set('error');
    this._message.set(message);
    this._detail.set(detail);
    return null;
  }
}
