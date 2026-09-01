import { Injectable, computed, inject, signal } from '@angular/core';

import { DataStore } from '../data/data-store';
import { failureMessage } from './annotation-generator';
import { GradingFormCategory, UUID } from '../models';
import { callFunction } from '../supabase/function-call';
import { SupabaseService } from '../supabase/supabase';

/**
 * Asks the model to answer her objection to one criterion's score.
 *
 * The other half of "משא ומתן כזה". She writes why she disagrees; this sends
 * that one criterion — its score, its reasoning, her note and the paper — and
 * brings back an answer, with a revised score when it is persuaded.
 *
 * Its own Edge Function rather than a mode of `annotate`, because the work is
 * a fraction of the size. Re-running a full drafting pass to answer a single
 * objection would spend a minute and most of a quota to change one number.
 */

interface ReplyResponse {
  reply: string;
  points: number | null;
  changed: boolean;
  rationale: string;
}

/**
 * How much of the paper to send.
 *
 * The whole thing is what makes an answer worth reading — the objection is
 * usually about evidence — but a criterion reply that costs as much as a full
 * marking pass is one she will stop using. Trimmed from the front, where the
 * introduction and the chapter under discussion sit.
 */
const MAX_BLOCKS = 120;

@Injectable({ providedIn: 'root' })
export class CriterionReply {
  private readonly supabase = inject(SupabaseService);
  private readonly data = inject(DataStore);

  /** Which criterion is waiting on an answer. One at a time. */
  private readonly _pending = signal<UUID | null>(null);
  private readonly _error = signal<string | null>(null);

  readonly error = this._error.asReadonly();
  readonly available = this.supabase.isConfigured;

  readonly pending = computed(() => this._pending());

  isAsking(categoryId: UUID): boolean {
    return this._pending() === categoryId;
  }

  /**
   * Sends her note and stores whatever comes back.
   *
   * Returns false on any failure, with `error` set — a silent no-op here would
   * look exactly like the model having nothing to say, which is a different
   * and much more interesting answer than "the call failed".
   */
  async ask(submissionId: UUID, category: GradingFormCategory): Promise<boolean> {
    const score = this.data
      .criterionScores(submissionId)
      .find((s) => s.category_id === category.id);

    const note = score?.teacher_note?.trim();
    if (!note) return false;

    const round = this.data.roundFor(submissionId);
    const course = this.data.course();
    const assignment = this.data.assignment();
    if (!course || !assignment) return false;

    this._pending.set(category.id);
    this._error.set(null);

    try {
      const answer = await callFunction<ReplyResponse>(this.supabase, 'criterion-reply', {
        criterion: {
          name: category.name,
          section: category.section,
          max_points: category.max_points,
        },
        points: score?.points ?? null,
        rationale: score?.rationale ?? null,
        note,
        blocks: (round?.document_blocks ?? [])
          .slice(0, MAX_BLOCKS)
          .map((b) => ({ type: b.type, text: b.text })),
        course_name: course.name,
        assignment_title: assignment.title,
      });

      this.data.applyCriterionReply(submissionId, category.id, {
        reply: answer.reply,
        points: answer.points,
        rationale: answer.rationale,
      });
      return true;
    } catch (error) {
      // Same wording as a failed drafting run, including which key's quota ran
      // out — the causes are identical and she should not have to learn two
      // vocabularies for the same problem.
      this._error.set(failureMessage(error));
      return false;
    } finally {
      this._pending.set(null);
    }
  }
}
