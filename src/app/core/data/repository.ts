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
  TeacherStyleExample,
  UUID,
} from '../models';

/**
 * Everything that has to survive a reload.
 *
 * Seeded demonstration records are not in here — they are the store's starting
 * contents, and anything persisted is layered over them by id.
 */
export interface PersistedSnapshot {
  /**
   * The teacher's own course, assignment and roster.
   *
   * These used to live only as constants in `seed-data.ts`, which meant a
   * signed-in teacher had no `courses` row, no `assignments` row and no
   * `students` — and every submission, annotation and feedback log she
   * produced referenced ids that did not exist. Postgres refused all of it on
   * the foreign keys.
   */
  courses: Course[];
  assignments: Assignment[];
  students: Student[];

  /** Her rules and reference material for the course — AI context, per course. */
  courseRules: CourseRule[];
  courseMaterials: CourseMaterial[];

  /** The internal grading form: her headings, and the lines under them. */
  gradingCategories: GradingFormCategory[];
  /** One score per rubric criterion per submission, filled in as work arrives. */
  criterionScores: GradingCriterionScore[];
  gradingEntries: GradingFormEntry[];
  /** The year-end forms the students receive. */
  studentForms: StudentGradingForm[];
  /** The messages that carry a round of comments back to the student. */
  studentEmails: StudentEmail[];
  /** Authenticity observations. The most sensitive records in the schema. */
  reliabilityChecks: ReliabilityCheck[];

  submissions: Submission[];
  rounds: SubmissionRound[];
  annotations: Annotation[];
  /** Watched Drive folder, keyed by the course or assignment it belongs to. */
  driveFolders: Record<UUID, string>;
  /** Her decisions on drafted comments — the signal later drafts learn from. */
  feedbackLogs: LearningFeedbackLog[];
  /** Samples of her own writing. Read-only for now; nothing here writes them. */
  styleExamples: TeacherStyleExample[];
}

/**
 * Thrown when a Supabase call is attempted with nobody signed in.
 *
 * Worth its own sentinel: RLS answers an unauthenticated read with an empty
 * result and an unauthenticated write with a 401, and neither on its own tells
 * the teacher the one thing she needs to know — that she is signed out and her
 * work is not being saved.
 */
export const NOT_SIGNED_IN = 'not_signed_in';

export const EMPTY_SNAPSHOT: PersistedSnapshot = {
  courses: [],
  assignments: [],
  students: [],
  courseRules: [],
  courseMaterials: [],
  gradingCategories: [],
  criterionScores: [],
  gradingEntries: [],
  studentForms: [],
  studentEmails: [],
  reliabilityChecks: [],
  submissions: [],
  rounds: [],
  annotations: [],
  driveFolders: {},
  feedbackLogs: [],
  styleExamples: [],
};

/**
 * Where durable records live.
 *
 * Two adapters implement this: Supabase when the project is configured, and a
 * browser-storage one when it isn't, so the app is still usable — and
 * testable — before credentials are filled in. The store never knows which it
 * is talking to.
 */
export abstract class Repository {
  abstract readonly kind: 'supabase' | 'local';

  abstract load(): Promise<PersistedSnapshot>;

  /**
   * The rows everything else points at. Written once, before anything that
   * references them, so the foreign keys resolve.
   */
  abstract saveCourse(course: Course): Promise<void>;
  abstract saveAssignment(assignment: Assignment): Promise<void>;
  abstract saveStudent(student: Student): Promise<void>;

  abstract saveCourseRule(rule: CourseRule): Promise<void>;
  abstract saveCourseMaterial(material: CourseMaterial): Promise<void>;
  abstract saveStyleExample(example: TeacherStyleExample): Promise<void>;

  abstract saveGradingCategory(category: GradingFormCategory): Promise<void>;
  abstract saveCriterionScore(score: GradingCriterionScore): Promise<void>;
  abstract saveGradingEntry(entry: GradingFormEntry): Promise<void>;
  /** Entries whose annotation she has since dismissed leave the form. */
  abstract deleteGradingEntries(ids: readonly UUID[]): Promise<void>;

  abstract saveStudentForm(form: StudentGradingForm): Promise<void>;

  /**
   * The drafted message, its options, and whatever she made of them.
   *
   * Saved from the moment it is drafted rather than at the point of sending:
   * the draft is work, and work that only exists in a signal is work she can
   * lose by closing a tab.
   */
  abstract saveStudentEmail(email: StudentEmail): Promise<void>;

  /**
   * One check per round, replaced when it is re-run.
   *
   * Never appended to: a superseded observation about a student's honesty is
   * not history worth keeping, and a trail of them would be read as a pattern.
   */
  abstract saveReliabilityCheck(check: ReliabilityCheck): Promise<void>;

  abstract saveSubmission(submission: Submission): Promise<void>;
  abstract saveRound(round: SubmissionRound): Promise<void>;
  abstract saveAnnotation(annotation: Annotation): Promise<void>;
  /** Hard delete — used when a drafted batch is thrown away, not for dismissal. */
  abstract deleteAnnotations(ids: readonly UUID[]): Promise<void>;
  abstract saveDriveFolder(ownerId: UUID, folderId: string | null): Promise<void>;

  /**
   * Removes a decision she took back.
   *
   * Deleted rather than superseded by a "she undid it" row. The log is keyed
   * on (target_type, target_id) and read as the record of what she wanted, so
   * a decision she reversed has to leave nothing behind — an undone edit that
   * stays in the log teaches the model a phrasing she rejected, and it would
   * do it silently, a year later, with nothing to trace it back to.
   */
  abstract deleteFeedbackLogs(ids: readonly UUID[]): Promise<void>;

  /**
   * Removes course rules and materials outright.
   *
   * Deletion rather than deactivation, because she asked for both and they are
   * different acts. A rule switched off is one she may want back next year and
   * that the screen still shows; a rule deleted is one that was a mistake — a
   * duplicate, a paste of the wrong paragraph — and leaving it greyed out
   * forever is clutter she cannot clear.
   */
  /**
   * Removes a student, or a paper, and everything hanging off it.
   *
   * Postgres cascades: rounds, annotations, grading entries, criterion scores,
   * the drafted message and the reliability checks all carry
   * `on delete cascade`. Nothing here has to enumerate them, and nothing here
   * should try — a list of children maintained by hand drifts from the schema
   * and leaves orphans nobody looks for.
   */
  abstract deleteStudents(ids: readonly UUID[]): Promise<void>;
  abstract deleteSubmissions(ids: readonly UUID[]): Promise<void>;

  abstract deleteCourseRules(ids: readonly UUID[]): Promise<void>;
  abstract deleteCourseMaterials(ids: readonly UUID[]): Promise<void>;

  /**
   * One log per drafted comment, superseded in place when she changes her mind.
   * The store reuses the existing record's id, so this stays a plain upsert.
   *
   * Deliberately not deleted alongside its annotation: `target_id` carries no
   * foreign key, and the before/after pair is self-contained training data that
   * outlives the comment it came from.
   */
  abstract saveFeedbackLog(log: LearningFeedbackLog): Promise<void>;
}
