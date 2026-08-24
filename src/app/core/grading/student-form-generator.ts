import { Injectable, computed, inject, signal } from '@angular/core';

import { DataStore } from '../data/data-store';
import { derivedId } from '../ids';
import { GradingFormEntry, StudentGradingForm, StudentGradingFormSection, UUID } from '../models';
import { FunctionError, TRANSPORT_MESSAGES, callFunction } from '../supabase/function-call';
import { SupabaseService } from '../supabase/supabase';

/**
 * The year-end form the student receives.
 *
 * Not the internal one softened — a translation, learned from the pairs she
 * has already produced. `buildTranslations` is the whole idea: for every past
 * form that recorded which internal entries it came from, we hand the model
 * both halves and ask it to do the same thing again.
 */

export interface StudentFormRequest {
  student_name: string;
  course_name: string;
  year: string;
  categories: { id: string; name: string; description: string | null }[];
  entries: { category_id: string; body: string; quote: string | null }[];
  translations: { internal: string[]; student: string }[];
  style_examples: { teacher_text: string; student_text: string | null }[];
}

export interface StudentFormResponse {
  summary: string;
  sections: { category_id: string; title: string; body: string }[];
}

const FAILURE_MESSAGES: Record<string, string> = {
  safety_blocked: 'חלק מהטופס הזה לא עבר עיבוד אוטומטי. אפשר לכתוב אותו ידנית.',
  rate_limited: 'יותר מדי בקשות ברצף. אפשר לנסות שוב עוד רגע.',
  daily_cap: 'נגמרה המכסה היומית. אפשר לנסות שוב מחר.',
  bad_response: 'התשובה שהתקבלה לא הייתה שלמה. אפשר לנסות שוב.',
  no_entries: 'אין עדיין שורות בטופס הפנימי של התלמידה הזו.',
  generation_failed: 'משהו השתבש בניסוח הטופס. אפשר לנסות שוב.',
};

/** Enough to show the pattern without spending the whole context on it. */
const MAX_TRANSLATIONS = 12;
const MAX_STYLE_EXAMPLES = 30;

/**
 * Her own internal-to-student pairs.
 *
 * A past `StudentGradingForm` records `source_entry_ids`, so each one can be
 * put back beside the internal lines it was written from. That pairing is the
 * only real evidence of how she makes this translation; without it the model
 * is guessing at a register, and guessing produces the school-report voice
 * this whole app exists to avoid.
 */
export function buildTranslations(
  forms: readonly StudentGradingForm[],
  entries: readonly GradingFormEntry[],
): { internal: string[]; student: string }[] {
  const byId = new Map(entries.map((e) => [e.id, e]));

  return (
    forms
      // Only forms that actually went out. A draft she never approved is not
      // evidence of anything.
      .filter((form) => form.status === 'sent' && form.source_entry_ids.length)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .flatMap((form) => {
        const sources = form.source_entry_ids
          .map((id) => byId.get(id))
          .filter((entry): entry is GradingFormEntry => !!entry);
        if (!sources.length) return [];

        // Paired section by section, not whole form to whole form: the notes
        // that became a given paragraph teach the transformation far better
        // than the year's notes beside the year's letter.
        return form.sections
          .filter((section) => section.body.trim())
          .map((section) => {
            const internal = sources
              .filter((entry) => !section.category_id || entry.category_id === section.category_id)
              .map((entry) => entry.body);
            return internal.length ? { internal, student: section.body } : null;
          })
          .filter((pair): pair is { internal: string[]; student: string } => !!pair);
      })
      .slice(0, MAX_TRANSLATIONS)
  );
}

export type GenerationPhase = 'idle' | 'generating' | 'error';

@Injectable({ providedIn: 'root' })
export class StudentFormGenerator {
  private readonly store = inject(DataStore);
  private readonly supabase = inject(SupabaseService);

  private readonly _phase = signal<GenerationPhase>('idle');
  private readonly _message = signal<string | null>(null);
  private readonly _detail = signal<string | null>(null);

  readonly phase = this._phase.asReadonly();
  readonly message = this._message.asReadonly();
  /** The raw failure, for the small print. */
  readonly detail = this._detail.asReadonly();
  readonly isGenerating = computed(() => this._phase() === 'generating');

  /**
   * Builds the student's form from every internal line she has for that
   * student this year, across all her submissions.
   */
  async generate(studentId: UUID): Promise<StudentGradingForm | null> {
    if (this.isGenerating()) return null;

    const course = this.store.course();
    if (!course) return null;
    const categories = this.store.gradingCategories();
    const submissionIds = new Set(
      this.store
        .submissions()
        .filter((s) => s.student_id === studentId)
        .map((s) => s.id),
    );

    const entries = this.store.gradingEntries().filter((e) => submissionIds.has(e.submission_id));
    if (!entries.length) return this.fail(FAILURE_MESSAGES['no_entries']);
    if (!this.supabase.isConfigured) {
      return this.fail('צריך למלא את פרטי Supabase לפני שאפשר לנסח טפסים.');
    }

    this._phase.set('generating');
    this._message.set(null);
    this._detail.set(null);

    const annotations = this.store.annotations();
    const request: StudentFormRequest = {
      student_name: this.store.studentName(studentId),
      course_name: course.name,
      year: course.year,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
      })),
      entries: entries.map((e) => ({
        category_id: e.category_id,
        body: e.body,
        quote: annotations.find((a) => a.id === e.annotation_id)?.anchor.quote ?? null,
      })),
      translations: buildTranslations(this.store.studentForms(), this.store.gradingEntries()),
      style_examples: this.store
        .styleExamples()
        .filter((e) => e.active)
        .slice(0, MAX_STYLE_EXAMPLES)
        .map((e) => ({ teacher_text: e.teacher_text, student_text: e.student_text })),
    };

    let response: StudentFormResponse;
    try {
      response = await callFunction<StudentFormResponse>(this.supabase, 'student-form', request);
    } catch (error) {
      const code = error instanceof FunctionError ? error.code : '';
      const detail = error instanceof FunctionError ? error.detail : String(error);
      return this.fail(
        FAILURE_MESSAGES[code] ?? TRANSPORT_MESSAGES[code] ?? FAILURE_MESSAGES['generation_failed'],
        detail,
      );
    }

    const known = new Set(categories.map((c) => c.id));
    const sections: StudentGradingFormSection[] = (response.sections ?? [])
      .filter((s) => s.body?.trim())
      .map((s) => ({
        title: s.title?.trim() || '',
        body: s.body.trim(),
        category_id: known.has(s.category_id) ? s.category_id : null,
      }));

    const now = new Date().toISOString();
    const form: StudentGradingForm = {
      id: derivedId('student-form', `${studentId}:${course.id}:${course.year}`),
      student_id: studentId,
      course_id: course.id,
      year: course.year,
      sections,
      summary: response.summary?.trim() || null,
      status: 'draft',
      edited_by_teacher: false,
      // Provenance: which internal lines this was written from, which is also
      // what makes it usable as a training pair next year.
      source_entry_ids: entries.map((e) => e.id),
      approved_at: null,
      sent_at: null,
      created_at: now,
      updated_at: now,
    };

    this.store.saveStudentForm(form);
    this._phase.set('idle');
    return form;
  }

  private fail(message: string, detail: string | null = null): null {
    this._phase.set('error');
    this._message.set(message);
    this._detail.set(detail);
    return null;
  }
}
