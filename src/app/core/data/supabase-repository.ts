import { Injectable, inject } from '@angular/core';

import {
  Annotation,
  Assignment,
  Course,
  CourseMaterial,
  CourseRule,
  GradingCriterionScore,
  GradingFormCategory,
  GradingFormEntry,
  LearningFeedbackLog,
  ReliabilityCheck,
  Student,
  StudentEmail,
  StudentGradingForm,
  Submission,
  SubmissionRound,
  TABLES,
  TeacherStyleExample,
  UUID,
} from '../models';
import { SupabaseService } from '../supabase/supabase';
import { EMPTY_SNAPSHOT, NOT_SIGNED_IN, PersistedSnapshot, Repository } from './repository';

/** What supabase-js hands back when Postgres refuses. */
interface PostgrestFailure {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

/**
 * Plain-language notes for refusals whose wording is about PostgREST rather
 * than about anything the teacher or the code did wrong.
 *
 * `PGRST204` is the one that matters: it means the column the app is writing
 * does not exist in the database, which is always an unapplied migration —
 * and "could not find the column in the schema cache" gives no one a next
 * step. It is also uniquely destructive, because the client sends whole rows:
 * one missing column refuses *every* write to that table, and the rows that
 * then fail their foreign keys look like unrelated bugs one table over.
 */
const CODE_NOTES: Record<string, string> = {
  PGRST204:
    'the database is missing a column this version writes — a migration has not been applied',
  '23503': 'a row this one points at is not in the database',
  '42501': 'row-level security refused it — often a missing parent row rather than a permission',
};

/**
 * Everything Postgres said, not just its first line.
 *
 * `details` is where PostgREST puts the part that ends an investigation — for
 * a foreign key it names the exact key and the table it is missing from
 * ("Key (annotation_id)=(…) is not present in table annotations"). Throwing
 * only `message` discarded it, and that is precisely the sentence that would
 * have told this project's recurring bug apart from a permissions problem.
 */
export function describeFailure(table: string, error: PostgrestFailure): string {
  const note = error.code ? CODE_NOTES[error.code] : undefined;

  return [
    `${table}: ${error.message ?? 'unknown error'}`,
    error.details ? ` — ${error.details}` : '',
    note ? ` [${note}]` : '',
  ].join('');
}

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

  /**
   * Every call goes through here first.
   *
   * RLS is the security boundary, but it is a silent one: signed out, a select
   * returns zero rows rather than an error, and the app would cheerfully show
   * the seeded course as though the teacher's own were empty. Refusing up
   * front turns that into something the screen can say out loud.
   */
  private requireSession(): void {
    if (!this.supabase.session()) throw new Error(NOT_SIGNED_IN);
  }

  async load(): Promise<PersistedSnapshot> {
    this.requireSession();
    const client = this.supabase.client;

    // RLS scopes all of these to the signed-in teacher; there is no filtering
    // to do here beyond asking.
    const [
      submissions,
      rounds,
      annotations,
      courses,
      assignments,
      feedbackLogs,
      styleExamples,
      students,
      gradingCategories,
      criterionScores,
      gradingEntries,
      studentForms,
      studentEmails,
      reliabilityChecks,
      courseRules,
      courseMaterials,
    ] = await Promise.all([
      client.from(TABLES.submissions).select('*'),
      client.from(TABLES.submissionRounds).select('*'),
      client.from(TABLES.annotations).select('*'),
      client.from(TABLES.courses).select('*'),
      client.from(TABLES.assignments).select('*'),
      client.from(TABLES.learningFeedbackLogs).select('*'),
      client.from(TABLES.teacherStyleExamples).select('*'),
      client.from(TABLES.students).select('*'),
      client.from(TABLES.gradingFormCategories).select('*'),
      client.from(TABLES.criterionScores).select('*'),
      client.from(TABLES.gradingFormEntries).select('*'),
      client.from(TABLES.studentGradingForms).select('*'),
      client.from(TABLES.studentEmails).select('*'),
      client.from(TABLES.reliabilityChecks).select('*'),
      client.from(TABLES.courseRules).select('*'),
      client.from(TABLES.courseMaterials).select('*'),
    ]);

    // Paired with their tables, so a failed load names the query that failed.
    // It used to throw a bare message, which on a schema change said only
    // "column … does not exist" with no clue where to look.
    const results: [string, { error: PostgrestFailure | null }][] = [
      [TABLES.submissions, submissions],
      [TABLES.submissionRounds, rounds],
      [TABLES.annotations, annotations],
      [TABLES.courses, courses],
      [TABLES.assignments, assignments],
      [TABLES.learningFeedbackLogs, feedbackLogs],
      [TABLES.teacherStyleExamples, styleExamples],
      [TABLES.students, students],
      [TABLES.gradingFormCategories, gradingCategories],
      [TABLES.criterionScores, criterionScores],
      [TABLES.gradingFormEntries, gradingEntries],
      [TABLES.studentGradingForms, studentForms],
      [TABLES.studentEmails, studentEmails],
      [TABLES.reliabilityChecks, reliabilityChecks],
      [TABLES.courseRules, courseRules],
      [TABLES.courseMaterials, courseMaterials],
    ];

    const failed = results.find(([, result]) => result.error);
    if (failed) throw new Error(describeFailure(failed[0], failed[1].error!));

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
      courses: (courses.data ?? []) as Course[],
      assignments: (assignments.data ?? []) as Assignment[],
      students: (students.data ?? []) as Student[],
      gradingCategories: (gradingCategories.data ?? []) as GradingFormCategory[],
      criterionScores: (criterionScores.data ?? []) as GradingCriterionScore[],
      gradingEntries: (gradingEntries.data ?? []) as GradingFormEntry[],
      studentForms: (studentForms.data ?? []) as StudentGradingForm[],
      studentEmails: (studentEmails.data ?? []) as StudentEmail[],
      reliabilityChecks: (reliabilityChecks.data ?? []) as ReliabilityCheck[],
      courseRules: (courseRules.data ?? []) as CourseRule[],
      courseMaterials: (courseMaterials.data ?? []) as CourseMaterial[],
      driveFolders,
      feedbackLogs: (feedbackLogs.data ?? []) as LearningFeedbackLog[],
      styleExamples: (styleExamples.data ?? []) as TeacherStyleExample[],
    };
  }

  async saveCourse(course: Course): Promise<void> {
    await this.upsert(TABLES.courses, course, 'id');
  }

  async saveAssignment(assignment: Assignment): Promise<void> {
    await this.upsert(TABLES.assignments, assignment, 'id');
  }

  async saveStudent(student: Student): Promise<void> {
    await this.upsert(TABLES.students, student, 'id');
  }

  async saveCourseRule(rule: CourseRule): Promise<void> {
    await this.upsert(TABLES.courseRules, rule, 'id');
  }

  async saveCourseMaterial(material: CourseMaterial): Promise<void> {
    await this.upsert(TABLES.courseMaterials, material, 'id');
  }

  async saveStyleExample(example: TeacherStyleExample): Promise<void> {
    await this.upsert(TABLES.teacherStyleExamples, example, 'id');
  }

  async saveGradingCategory(category: GradingFormCategory): Promise<void> {
    await this.upsert(TABLES.gradingFormCategories, category, 'id');
  }

  async saveCriterionScore(score: GradingCriterionScore): Promise<void> {
    await this.upsert(TABLES.criterionScores, score, 'id');
  }

  async saveGradingEntry(entry: GradingFormEntry): Promise<void> {
    await this.upsert(TABLES.gradingFormEntries, entry, 'id');
  }

  async deleteGradingEntries(ids: readonly UUID[]): Promise<void> {
    if (ids.length === 0) return;
    this.requireSession();
    const { error } = await this.supabase.client
      .from(TABLES.gradingFormEntries)
      .delete()
      .in('id', [...ids]);
    if (error) throw new Error(describeFailure(TABLES.gradingFormEntries, error));
  }

  async saveStudentForm(form: StudentGradingForm): Promise<void> {
    await this.upsert(TABLES.studentGradingForms, form, 'id');
  }

  async saveStudentEmail(email: StudentEmail): Promise<void> {
    await this.upsert(TABLES.studentEmails, email, 'id');
  }

  async saveReliabilityCheck(check: ReliabilityCheck): Promise<void> {
    await this.upsert(TABLES.reliabilityChecks, check, 'id');
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

  async deleteCourseRules(ids: readonly UUID[]): Promise<void> {
    await this.deleteRows(TABLES.courseRules, ids);
  }

  async deleteCourseMaterials(ids: readonly UUID[]): Promise<void> {
    await this.deleteRows(TABLES.courseMaterials, ids);
  }

  /** One delete, so the session check and the error wording cannot drift. */
  private async deleteRows(table: string, ids: readonly UUID[]): Promise<void> {
    if (ids.length === 0) return;
    this.requireSession();
    const { error } = await this.supabase.client
      .from(table)
      .delete()
      .in('id', [...ids]);
    if (error) throw new Error(describeFailure(table, error));
  }

  async deleteFeedbackLogs(ids: readonly UUID[]): Promise<void> {
    if (ids.length === 0) return;
    this.requireSession();
    const { error } = await this.supabase.client
      .from(TABLES.learningFeedbackLogs)
      .delete()
      .in('id', [...ids]);
    if (error) throw new Error(describeFailure(TABLES.learningFeedbackLogs, error));
  }

  async deleteAnnotations(ids: readonly UUID[]): Promise<void> {
    if (ids.length === 0) return;
    this.requireSession();
    const { error } = await this.supabase.client
      .from(TABLES.annotations)
      .delete()
      .in('id', [...ids]);
    if (error) throw new Error(describeFailure(TABLES.annotations, error));
  }

  /**
   * The folder is configuration on the course (or assignment) row rather than
   * a record of its own, so this is an update, not an upsert — the row is
   * already there.
   */
  async saveDriveFolder(ownerId: UUID, folderId: string | null): Promise<void> {
    this.requireSession();
    const client = this.supabase.client;

    const course = await client
      .from(TABLES.courses)
      .update({ drive_folder_id: folderId })
      .eq('id', ownerId)
      .select('id');

    if (course.error) throw new Error(describeFailure(TABLES.courses, course.error));
    if ((course.data ?? []).length > 0) return;

    const assignment = await client
      .from(TABLES.assignments)
      .update({ drive_folder_id: folderId })
      .eq('id', ownerId)
      .select('id');

    if (assignment.error) throw new Error(describeFailure(TABLES.assignments, assignment.error));
  }

  private async upsert(table: string, row: object, onConflict: string): Promise<void> {
    this.requireSession();
    const { error } = await this.supabase.client.from(table).upsert(row, { onConflict });
    if (error) throw new Error(describeFailure(table, error));
  }
}
