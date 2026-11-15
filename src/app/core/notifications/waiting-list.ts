import { Injectable, computed, inject, signal } from '@angular/core';

import { AnnotationGenerator } from '../ai/annotation-generator';
import { DataStore } from '../data/data-store';
import { WaitingGroup, groupWaiting, waitingFor } from './waiting';

export interface CheckRun {
  taskId: string;
  title: string;
  running: boolean;
  total: number;
  done: number;
  current: string;
  failed: string[];
}

/**
 * What is waiting for her across the selected year, grouped by task, and the
 * one job she can start from it: checking every unread paper of a task.
 *
 * One place, so the home screen, the sidebar and the bell always agree, and a
 * run she started keeps going while she moves between screens.
 */
@Injectable({ providedIn: 'root' })
export class WaitingList {
  private readonly data = inject(DataStore);
  private readonly generator = inject(AnnotationGenerator);

  readonly canCheck = this.generator.canGenerate;

  readonly groups = computed<WaitingGroup[]>(() => {
    const tasks = this.data.coursesInYear().flatMap((course) =>
      this.data
        .assignmentsOf(course.id)
        .map((task) => ({ id: task.id, title: task.title, course: course.name })),
    );
    const ids = new Set(tasks.map((t) => t.id));
    const items = waitingFor(
      this.data.submissions().filter((p) => ids.has(p.assignment_id)),
      this.data.annotations(),
      (id) => this.data.studentName(id),
    );
    return groupWaiting(items, tasks);
  });

  readonly total = computed(() => this.groups().reduce((sum, g) => sum + g.items.length, 0));

  /** Course names help only when she teaches more than one this year. */
  readonly showCourse = computed(() => this.data.coursesInYear().length > 1);

  private readonly _run = signal<CheckRun | null>(null);
  readonly run = this._run.asReadonly();
  private stopRequested = false;

  /** Checks every paper of the task that nobody has looked at yet, one at a time. */
  async checkAll(group: WaitingGroup): Promise<void> {
    if (this._run()?.running || !group.unchecked.length) return;
    const work = [...group.unchecked];
    this.stopRequested = false;
    this._run.set({
      taskId: group.id,
      title: group.title,
      running: true,
      total: work.length,
      done: 0,
      current: '',
      failed: [],
    });

    for (const item of work) {
      if (this.stopRequested) break;
      this._run.update((r) => r && { ...r, current: item.student });
      const result = await this.generator.generate(item.paperId);
      this._run.update(
        (r) =>
          r && {
            ...r,
            done: r.done + 1,
            failed: result
              ? r.failed
              : [...r.failed, `${item.student}: ${this.generator.state().message ?? 'הבדיקה לא הצליחה.'}`],
          },
      );
    }

    this._run.update((r) => r && { ...r, running: false, current: '', total: r.done });
  }

  stop() {
    this.stopRequested = true;
  }

  clear() {
    if (!this._run()?.running) this._run.set(null);
  }
}
