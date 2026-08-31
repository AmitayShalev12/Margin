import { Injectable } from '@angular/core';

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
  TeacherStyleExample,
  StudentGradingForm,
  Submission,
  SubmissionRound,
  UUID,
} from '../models';
import { EMPTY_SNAPSHOT, PersistedSnapshot, Repository } from './repository';

const STORAGE_KEY = 'margin.persisted';

/**
 * Durable storage in the browser, used when Supabase is not configured.
 *
 * This exists so the app is usable before credentials are filled in — a
 * refresh keeps synced records and review decisions rather than dropping back
 * to the seed. It holds no credentials, only records the teacher can already
 * see on screen.
 *
 * The snapshot is held in memory and written out whole. Reading it back per
 * save would lose writes: a sync fires several saves at once, and each would
 * start from the same stale copy and overwrite the others.
 */
@Injectable()
export class LocalRepository extends Repository {
  readonly kind = 'local' as const;

  private snapshot: PersistedSnapshot | null = null;

  async load(): Promise<PersistedSnapshot> {
    this.snapshot = read();
    return clone(this.snapshot);
  }

  async saveCourse(course: Course): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.courses = replaceById(snapshot.courses, course);
    });
  }

  async saveAssignment(assignment: Assignment): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.assignments = replaceById(snapshot.assignments, assignment);
    });
  }

  async saveStudent(student: Student): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.students = replaceById(snapshot.students, student);
    });
  }

  async saveCourseRule(rule: CourseRule): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.courseRules = replaceById(snapshot.courseRules, rule);
    });
  }

  async saveCourseMaterial(material: CourseMaterial): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.courseMaterials = replaceById(snapshot.courseMaterials, material);
    });
  }

  async saveStyleExample(example: TeacherStyleExample): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.styleExamples = replaceById(snapshot.styleExamples, example);
    });
  }

  async saveGradingCategory(category: GradingFormCategory): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.gradingCategories = replaceById(snapshot.gradingCategories, category);
    });
  }

  async saveCriterionScore(score: GradingCriterionScore): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.criterionScores = replaceById(snapshot.criterionScores, score);
    });
  }

  async saveGradingEntry(entry: GradingFormEntry): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.gradingEntries = replaceById(snapshot.gradingEntries, entry);
    });
  }

  async deleteGradingEntries(ids: readonly UUID[]): Promise<void> {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    this.mutate((snapshot) => {
      snapshot.gradingEntries = snapshot.gradingEntries.filter((e) => !gone.has(e.id));
    });
  }

  async saveStudentForm(form: StudentGradingForm): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.studentForms = replaceById(snapshot.studentForms, form);
    });
  }

  async saveStudentEmail(email: StudentEmail): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.studentEmails = replaceById(snapshot.studentEmails, email);
    });
  }

  async saveReliabilityCheck(check: ReliabilityCheck): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.reliabilityChecks = replaceById(snapshot.reliabilityChecks, check);
    });
  }

  async saveSubmission(submission: Submission): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.submissions = replaceById(snapshot.submissions, submission);
    });
  }

  async saveRound(round: SubmissionRound): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.rounds = replaceById(snapshot.rounds, round);
    });
  }

  async saveAnnotation(annotation: Annotation): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.annotations = replaceById(snapshot.annotations, annotation);
    });
  }

  async deleteAnnotations(ids: readonly UUID[]): Promise<void> {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    this.mutate((snapshot) => {
      snapshot.annotations = snapshot.annotations.filter((a) => !gone.has(a.id));
    });
  }

  async deleteFeedbackLogs(ids: readonly UUID[]): Promise<void> {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    this.mutate((snapshot) => {
      snapshot.feedbackLogs = snapshot.feedbackLogs.filter((l) => !gone.has(l.id));
    });
  }

  async saveFeedbackLog(log: LearningFeedbackLog): Promise<void> {
    this.mutate((snapshot) => {
      snapshot.feedbackLogs = replaceById(snapshot.feedbackLogs, log);
    });
  }

  async saveDriveFolder(ownerId: UUID, folderId: string | null): Promise<void> {
    this.mutate((snapshot) => {
      if (folderId) snapshot.driveFolders[ownerId] = folderId;
      else delete snapshot.driveFolders[ownerId];
    });
  }

  /**
   * Applies a change to the cached snapshot and flushes it. Synchronous on
   * purpose — there is no await between reading the current state and writing
   * the new one, so concurrent saves cannot interleave.
   */
  private mutate(apply: (snapshot: PersistedSnapshot) => void): void {
    this.snapshot ??= read();
    apply(this.snapshot);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot));
    } catch {
      // Quota or private browsing: the write is lost, which is the same
      // situation as having no storage at all.
    }
  }
}

function read(): PersistedSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(EMPTY_SNAPSHOT);
    const parsed = JSON.parse(raw) as Partial<PersistedSnapshot>;
    return {
      courses: parsed.courses ?? [],
      assignments: parsed.assignments ?? [],
      students: parsed.students ?? [],
      courseRules: parsed.courseRules ?? [],
      courseMaterials: parsed.courseMaterials ?? [],
      gradingCategories: parsed.gradingCategories ?? [],
      criterionScores: parsed.criterionScores ?? [],
      gradingEntries: parsed.gradingEntries ?? [],
      studentForms: parsed.studentForms ?? [],
      studentEmails: parsed.studentEmails ?? [],
      reliabilityChecks: parsed.reliabilityChecks ?? [],
      submissions: parsed.submissions ?? [],
      rounds: parsed.rounds ?? [],
      annotations: parsed.annotations ?? [],
      driveFolders: parsed.driveFolders ?? {},
      feedbackLogs: parsed.feedbackLogs ?? [],
      styleExamples: parsed.styleExamples ?? [],
    };
  } catch {
    // Corrupt or unavailable storage shouldn't stop the app booting.
    return clone(EMPTY_SNAPSHOT);
  }
}

function clone(snapshot: PersistedSnapshot): PersistedSnapshot {
  return {
    courses: [...snapshot.courses],
    assignments: [...snapshot.assignments],
    students: [...snapshot.students],
    courseRules: [...snapshot.courseRules],
    courseMaterials: [...snapshot.courseMaterials],
    gradingCategories: [...snapshot.gradingCategories],
    criterionScores: [...snapshot.criterionScores],
    gradingEntries: [...snapshot.gradingEntries],
    studentForms: [...snapshot.studentForms],
    studentEmails: [...snapshot.studentEmails],
    reliabilityChecks: [...snapshot.reliabilityChecks],
    submissions: [...snapshot.submissions],
    rounds: [...snapshot.rounds],
    annotations: [...snapshot.annotations],
    driveFolders: { ...snapshot.driveFolders },
    feedbackLogs: [...snapshot.feedbackLogs],
    styleExamples: [...snapshot.styleExamples],
  };
}

function replaceById<T extends { id: string }>(list: T[], record: T): T[] {
  const index = list.findIndex((item) => item.id === record.id);
  if (index === -1) return [...list, record];
  const next = [...list];
  next[index] = record;
  return next;
}
