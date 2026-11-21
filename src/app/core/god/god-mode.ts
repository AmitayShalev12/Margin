import { Injectable, computed, inject } from '@angular/core';

import { DataStore } from '../data/data-store';
import { currentYearLabel } from '../dates/hebrew-date';
import { newId } from '../ids';
import { Assignment, Student, Submission, UUID } from '../models';
import { SupabaseService } from '../supabase/supabase';
import { SEMINAR_STAGES } from '../tasks/seminar-map';
import { PaperSize, fakePaper, revisedPaper } from './fake-paper';

/** The course the invented students live in. Found again by this name. */
export const GOD_COURSE = 'קורס ניסוי (מומצא)';

/** Invented people. The address ending is how they are told apart from real ones. */
export const FAKE_DOMAIN = '@fake.example';
export const FAKE_STUDENTS: readonly { name: string; email: string }[] = [
  { name: 'נועה ניסוי', email: `noa${FAKE_DOMAIN}` },
  { name: 'שירה ניסוי', email: `shira${FAKE_DOMAIN}` },
  { name: 'דנה ניסוי', email: `dana${FAKE_DOMAIN}` },
  { name: 'מאיה ניסוי', email: `maya${FAKE_DOMAIN}` },
  { name: 'תמר ניסוי', email: `tamar${FAKE_DOMAIN}` },
];

/** The one account this screen opens for, kept as a fingerprint and not as an address. */
const OWNER = 'd366f15b';

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export function isOwner(email: string | null | undefined): boolean {
  const name = (email ?? '').trim().toLowerCase().split('@')[0];
  return !!name && fingerprint(name) === OWNER;
}

/** A paper counts as checked once it has notes or its notes were sent. */
const SENT = new Set(['notes_sent', 'student_revised']);

/**
 * The test screen's hands: invented students who hand in invented papers.
 *
 * Everything goes through the same store calls the real screens use, into the
 * signed-in account only, so what it makes behaves exactly like real work and
 * can be checked, scored, answered and deleted the ordinary way.
 */
@Injectable({ providedIn: 'root' })
export class GodMode {
  private readonly store = inject(DataStore);
  private readonly supabase = inject(SupabaseService);

  /** Only the owner's account, or a build with no server at all. */
  readonly allowed = computed(
    () => !this.supabase.isConfigured || isOwner(this.supabase.user()?.email),
  );

  readonly course = computed(() => this.store.courses().find((c) => c.name === GOD_COURSE) ?? null);

  readonly students = computed<Student[]>(() =>
    this.store.students().filter((s) => (s.email ?? '').endsWith(FAKE_DOMAIN)),
  );

  readonly tasks = computed<Assignment[]>(() => {
    const course = this.course();
    return course ? this.store.assignmentsOf(course.id) : [];
  });

  /** Makes the course, its sixteen stages with their rubrics, and the five students. */
  setUp(): boolean {
    if (!this.allowed()) return false;

    let course = this.course();
    if (!course) {
      course = this.store.createCourse(GOD_COURSE, currentYearLabel(), {
        isSeminar: true,
        asksQuestion: true,
      });
      if (!course) return false;
    }
    this.store.selectCourse(course.id);

    if (!this.store.assignmentsOf(course.id).length) {
      for (const title of SEMINAR_STAGES) this.store.addTask(title, null);
      this.store.applyProposedRubrics();
    }

    const have = new Set(this.students().map((s) => s.email));
    for (const fake of FAKE_STUDENTS) {
      if (!have.has(fake.email)) this.store.addStudent(fake.name, fake.email, [course.id]);
    }
    return true;
  }

  papersOf(studentId: UUID): Submission[] {
    const mine = new Set(this.tasks().map((t) => t.id));
    return this.store
      .submissions()
      .filter((p) => p.student_id === studentId && mine.has(p.assignment_id));
  }

  /** The next stage she has not handed in. */
  nextTask(studentId: UUID): Assignment | null {
    const handed = new Set(this.papersOf(studentId).map((p) => p.assignment_id));
    return this.tasks().find((t) => !handed.has(t.id)) ?? null;
  }

  /** She hands in her next stage, as a paper of the size asked for. */
  submit(studentId: UUID, size: PaperSize): Submission | null {
    const student = this.students().find((s) => s.id === studentId);
    const task = this.nextTask(studentId);
    if (!this.allowed() || !student || !task) return null;

    const stage = this.tasks().indexOf(task);
    const paper = fakePaper({
      student: student.full_name,
      task: task.title,
      size,
      seed: (FAKE_STUDENTS.findIndex((f) => f.email === student.email) + 2) * 1000 + stage * 37 + 1,
    });

    return this.store.addUploadedSubmission({
      studentId,
      title: task.title,
      blocks: paper.blocks,
      text: paper.text,
      fileName: `${student.full_name} - ${task.title}.docx`,
      assignmentId: task.id,
    });
  }

  /** Whether a corrected version would open a new round, the way a real one does. */
  canResubmit(paper: Submission): boolean {
    const round = this.store.roundFor(paper.id);
    return !!round && (SENT.has(paper.status) || this.store.roundIsAnnotated(round.id));
  }

  /**
   * She hands in a corrected version of a paper that was already checked.
   *
   * The same thing the Drive sync does when a checked file changes: a new
   * round opens with the new text, and the earlier round stays as it was.
   */
  resubmit(paperId: UUID): boolean {
    const paper = this.store.submission(paperId);
    const current = paper && this.store.roundFor(paper.id);
    if (!this.allowed() || !paper || !current?.document_blocks || !this.canResubmit(paper)) {
      return false;
    }

    const revised = revisedPaper(current.document_blocks);
    const now = new Date().toISOString();
    const round = paper.current_round + 1;

    this.store.updateSubmission(paper.id, {
      status: 'resubmitted',
      current_round: round,
      word_count: revised.words,
    });
    this.store.addRound({
      id: newId(),
      submission_id: paper.id,
      round_number: round,
      document_text: revised.text,
      document_blocks: revised.blocks,
      drive_revision_id: null,
      received_at: now,
      scoring: null,
      notes_sent_at: null,
      ai_summary: null,
      ai_summary_confirmed_at: null,
      created_at: now,
      updated_at: now,
    });
    return true;
  }

  /** Removes the invented students and everything they handed in. The course stays. */
  clear(): number {
    if (!this.allowed()) return 0;
    const fakes = this.students();
    for (const student of fakes) this.store.deleteStudent(student.id);
    return fakes.length;
  }
}
