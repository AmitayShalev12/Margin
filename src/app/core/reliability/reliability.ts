import { Injectable, inject } from '@angular/core';

import { DataStore } from '../data/data-store';
import { UUID } from '../models';
import { SupabaseService } from '../supabase/supabase';
import { CheckOutput, buildCheck } from './checks';

/**
 * Runs the authenticity checks for one submission.
 *
 * Pure computation over data the sync already captured — no Drive call, no
 * model call, nothing sent anywhere. That is deliberate: a check about a
 * student's honesty should not be a thing that leaves the building.
 *
 * Run on demand rather than automatically. The teacher asks the question when
 * she has a reason to; a panel that pre-emptively assesses every girl who hands
 * work in is a different tool from the one this is meant to be.
 */
@Injectable({ providedIn: 'root' })
export class ReliabilityService {
  private readonly store = inject(DataStore);
  private readonly supabase = inject(SupabaseService);

  /** Computes and stores the check for a submission's current round. */
  run(submissionId: UUID): CheckOutput | null {
    const submission = this.store.submission(submissionId);
    if (!submission) return null;

    const output = buildCheck({
      submission,
      round: this.store.roundFor(submissionId) ?? null,
      student: this.store.students().find((s) => s.id === submission.student_id),
      others: this.store.submissions(),
      rounds: this.store.rounds(),
      // So her own edits on a student's document never read as a stranger's.
      teacherEmail: this.supabase.user()?.email ?? null,
      checkedAt: new Date().toISOString(),
    });

    this.store.saveReliabilityCheck(output.check);
    return output;
  }
}
