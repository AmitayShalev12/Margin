import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { FAILURE_MESSAGES } from '../ai/annotation-generator';
import { DataStore } from '../data/data-store';
import { FunctionError, TRANSPORT_MESSAGES, callFunction } from '../supabase/function-call';
import { SupabaseService } from '../supabase/supabase';
import { ActionOutcome, AssistantActions } from './actions';
import { AssistantContext, AssistantResponse, AssistantTurn, ProposedAction } from './contract';

export interface ChatStep {
  id: string;
  action: ProposedAction;
  outcome: ActionOutcome;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The actions this answer asked for, and what happened to each. */
  steps: ChatStep[];
  /** A failure to get an answer at all, as opposed to an action that failed. */
  failed?: boolean;
}

/** The conversation sent with each request. Older turns stay on screen only. */
const HISTORY = 12;

let sequence = 0;
const nextId = () => `m${++sequence}`;

/**
 * The in-app assistant.
 *
 * She asks in Hebrew; the `assistant` Edge Function answers with a reply and
 * a list of actions from a fixed allowlist; this runs each action in order
 * through `AssistantActions` — as her, through the same store methods as her
 * buttons — and shows what really happened beside the reply. Anything that
 * cannot be undone waits for her to confirm it.
 *
 * What leaves the browser: her message, the recent conversation, and the
 * names and ids of her courses and students with counts. Never a paper or an
 * email address.
 */
@Injectable({ providedIn: 'root' })
export class Assistant {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  private readonly actions = inject(AssistantActions);

  readonly isOpen = signal(false);
  readonly busy = signal(false);
  readonly messages = signal<ChatMessage[]>([]);

  /** Whether there is a backend to ask. Without one, the panel says so. */
  readonly available = this.supabase.isConfigured;

  open() {
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
  }

  toggle() {
    this.isOpen.update((v) => !v);
  }

  clear() {
    if (!this.busy()) this.messages.set([]);
  }

  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || this.busy()) return;

    this.messages.update((list) => [
      ...list,
      { id: nextId(), role: 'user', text: message, steps: [] },
    ]);
    this.busy.set(true);

    try {
      const history: AssistantTurn[] = this.messages()
        .filter((m) => !m.failed)
        .slice(-HISTORY)
        .map((m) => ({ role: m.role, text: m.text }));

      const response = await callFunction<AssistantResponse>(this.supabase, 'assistant', {
        messages: history,
        context: this.context(),
      });

      const id = nextId();
      const steps: ChatStep[] = (response.actions ?? []).map((action) => ({
        id: nextId(),
        action,
        outcome: this.actions.needsConfirmation(action)
          ? this.actions.pending(action)
          : { status: 'running', title: 'מבצעת…', detail: '' },
      }));
      this.messages.update((list) => [
        ...list,
        { id, role: 'assistant', text: response.reply, steps },
      ]);

      // In order: "create the course, then add her to it" depends on it.
      for (const step of steps) {
        if (step.outcome.status !== 'running') continue;
        const outcome = await this.actions.run(step.action);
        this.setOutcome(id, step.id, outcome);
      }
    } catch (error) {
      this.messages.update((list) => [
        ...list,
        { id: nextId(), role: 'assistant', text: describe(error), steps: [], failed: true },
      ]);
    } finally {
      this.busy.set(false);
    }
  }

  /** She confirmed an action that cannot be undone. */
  async confirm(messageId: string, stepId: string): Promise<void> {
    const step = this.step(messageId, stepId);
    if (!step || step.outcome.status !== 'confirm') return;
    this.setOutcome(messageId, stepId, { ...step.outcome, status: 'running' });
    this.setOutcome(messageId, stepId, await this.actions.run(step.action, true));
  }

  /** She declined it. Nothing is done. */
  decline(messageId: string, stepId: string) {
    const step = this.step(messageId, stepId);
    if (!step || step.outcome.status !== 'confirm') return;
    this.setOutcome(messageId, stepId, {
      status: 'cancelled',
      title: step.outcome.title,
      detail: 'ביטלת. לא נמחק כלום.',
    });
  }

  /**
   * What the model is told about her app — enough to pick the right student
   * or course by id, and to answer "who is waiting on me". Names and counts
   * only: no paper text, no email addresses.
   */
  context(): AssistantContext {
    const enrolment = this.data.courseStudents();
    const submissions = this.data.submissions();
    const course = this.data.course();

    return {
      today: new Date().toISOString().slice(0, 10),
      screen: this.router.url,
      current_course: course ? { id: course.id, name: course.name, year: course.year } : null,
      courses: this.data.courses().map((c) => ({ id: c.id, name: c.name, year: c.year })),
      students: this.data.students().map((s) => {
        const papers = submissions.filter((p) => p.student_id === s.id);
        return {
          id: s.id,
          name: s.full_name,
          course_ids: enrolment.filter((l) => l.student_id === s.id).map((l) => l.course_id),
          papers: papers.length,
          pending_comments: papers.reduce((sum, p) => sum + this.data.annotationsPending(p.id), 0),
        };
      }),
    };
  }

  private step(messageId: string, stepId: string): ChatStep | undefined {
    return this.messages()
      .find((m) => m.id === messageId)
      ?.steps.find((s) => s.id === stepId);
  }

  private setOutcome(messageId: string, stepId: string, outcome: ActionOutcome) {
    this.messages.update((list) =>
      list.map((m) =>
        m.id !== messageId
          ? m
          : { ...m, steps: m.steps.map((s) => (s.id === stepId ? { ...s, outcome } : s)) },
      ),
    );
  }
}

/** The same words the rest of the app uses for the same failures. */
function describe(error: unknown): string {
  if (error instanceof FunctionError) {
    return (
      FAILURE_MESSAGES[error.code] ??
      TRANSPORT_MESSAGES[error.code] ??
      'לא הצלחתי לקבל תשובה. אפשר לנסות שוב.'
    );
  }
  return 'לא הצלחתי לקבל תשובה. אפשר לנסות שוב.';
}
