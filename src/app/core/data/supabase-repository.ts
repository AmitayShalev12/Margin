import { Injectable, inject } from '@angular/core';

import {
  Annotation,
  LearningFeedbackLog,
  Submission,
  SubmissionRound,
  TABLES,
  TeacherStyleExample,
  UUID,
} from '../models';
import { SupabaseService } from '../supabase/supabase';
import { EMPTY_SNAPSHOT, PersistedSnapshot, Repository } from './repository';

/**
 * Durable storage in Postgres.
 *
 * Model fields are the column names, so every write is a plain upsert with no
 * mapping layer. Conflict targets are chosen to match the schema's own unique
 * constraints, which is what makes a re-sync idempotent: the same Drive file
 * updates its row rather than inserting a duplicate.
 */
@Injectable()
export class SupabaseRepository extends Repository {
  readonly kind = 'supabase' as const;

  private readonly supabase = inject(SupabaseService);

  async load(): Promise<PersistedSnapshot> {
    const client = this.supabase.client;

    // RLS scopes all of these to the signed-in teacher; there is no filtering
    // to do here beyond asking.
    const [submissions, rounds, annotations, courses, assignments, feedbackLogs, styleExamples] =
      await Promise.all([
        client.from(TABLES.submissions).select('*'),
        client.from(TABLES.submissionRounds).select('*'),
        client.from(TABLES.annotations).select('*'),
        client.from(TABLES.courses).select('id,drive_folder_id'),
        client.from(TABLES.assignments).select('id,drive_folder_id'),
        client.from(TABLES.learningFeedbackLogs).select('*'),
        client.from(TABLES.teacherStyleExamples).select('*'),
      ]);

    const firstError =
      submissions.error ??
      rounds.error ??
      annotations.error ??
      courses.error ??
      assignments.error ??
      feedbackLogs.error ??
      styleExamples.error;
    if (firstError) throw new Error(firstError.message);

    const driveFolders: Record<UUID, string> = {};
    for (const row of [...(courses.data ?? []), ...(assignments.data ?? [])]) {
      const record = row as { id: UUID; drive_folder_id: string | null };
      if (record.drive_folder_id) driveFolders[record.id] = record.drive_folder_id;
    }

    return {
      ...EMPTY_SNAPSHOT,
      submissions: (submissions.data ?? []) as Submission[],
      rounds: (rounds.data ?? []) as SubmissionRound[],
      annotations: (annotations.data ?? []) as Annotation[],
      driveFolders,
      feedbackLogs: (feedbackLogs.data ?? []) as LearningFeedbackLog[],
      styleExamples: (styleExamples.data ?? []) as TeacherStyleExample[],
    };
  }

  async saveSubmission(submission: Submission): Promise<void> {
    // One Drive file is one submission; re-syncing the same file must update.
    await this.upsert(TABLES.submissions, submission, 'id');
  }

  async saveRound(round: SubmissionRound): Promise<void> {
    await this.upsert(TABLES.submissionRounds, round, 'id');
  }

  async saveAnnotation(annotation: Annotation): Promise<void> {
    await this.upsert(TABLES.annotations, annotation, 'id');
  }

  async saveFeedbackLog(log: LearningFeedbackLog): Promise<void> {
    await this.upsert(TABLES.learningFeedbackLogs, log, 'id');
  }

  async deleteAnnotations(ids: readonly UUID[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase.client
      .from(TABLES.annotations)
      .delete()
      .in('id', [...ids]);
    if (error) throw new Error(`${TABLES.annotations}: ${error.message}`);
  }

  /**
   * The folder is configuration on the course (or assignment) row rather than
   * a record of its own, so this is an update, not an upsert — the row is
   * already there.
   */
  async saveDriveFolder(ownerId: UUID, folderId: string | null): Promise<void> {
    const client = this.supabase.client;

    const course = await client
      .from(TABLES.courses)
      .update({ drive_folder_id: folderId })
      .eq('id', ownerId)
      .select('id');

    if (course.error) throw new Error(course.error.message);
    if ((course.data ?? []).length > 0) return;

    const assignment = await client
      .from(TABLES.assignments)
      .update({ drive_folder_id: folderId })
      .eq('id', ownerId)
      .select('id');

    if (assignment.error) throw new Error(assignment.error.message);
  }

  private async upsert(table: string, row: object, onConflict: string): Promise<void> {
    const { error } = await this.supabase.client.from(table).upsert(row, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
