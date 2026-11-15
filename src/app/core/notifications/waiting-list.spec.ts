import { TestBed } from '@angular/core/testing';

import { AnnotationGenerator } from '../ai/annotation-generator';
import { DataStore } from '../data/data-store';
import { Annotation, Submission } from '../models';
import { WaitingGroup, groupWaiting, waitingFor } from './waiting';
import { WaitingList } from './waiting-list';

/** All names are invented. */
const paper = (id: string, task: string, student: string) =>
  ({ id, assignment_id: task, student_id: student, status: 'submitted' }) as unknown as Submission;
const comment = (paperId: string, status: string) =>
  ({ id: `a-${paperId}`, submission_id: paperId, status }) as unknown as Annotation;
const name = (id: string) => ({ s1: 'נועה', s2: 'שירה', s3: 'דנה' })[id] ?? id;

const TASKS = [
  { id: 't1', title: 'עבודה 1', course: 'סמינריון' },
  { id: 't2', title: 'עבודה 2', course: 'סמינריון' },
  { id: 't3', title: 'עבודה 3', course: 'סמינריון' },
];

describe('what is waiting, by task', () => {
  const items = waitingFor(
    [paper('p1', 't2', 's1'), paper('p2', 't1', 's2'), paper('p3', 't2', 's3'), paper('p4', 't2', 's2')],
    [comment('p3', 'pending'), comment('p4', 'accepted')],
    name,
  );
  const groups = groupWaiting(items, TASKS);

  it('makes one group per task that has something waiting, in task order', () => {
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ['עבודה 1', 1],
      ['עבודה 2', 3],
    ]);
  });

  it('keeps the most urgent first inside a group, with short lines', () => {
    expect(groups[1].items.map((i) => `${i.student}: ${i.short}`)).toEqual([
      'שירה: מוכנה לשליחה',
      'דנה: הערה אחת להחלטה',
      'נועה: עוד לא נבדקה',
    ]);
  });

  it('counts only papers nobody has looked at as ready to check', () => {
    expect(groups[1].unchecked.map((i) => i.paperId)).toEqual(['p1']);
  });
});

describe('checking all of a task', () => {
  const group = (ids: string[]): WaitingGroup => {
    const items = waitingFor(
      ids.map((id, n) => paper(id, 't1', `s${n + 1}`)),
      [],
      name,
    );
    return { ...TASKS[0], items, unchecked: items };
  };

  function setup(generate: (id: string) => Promise<object | null>) {
    TestBed.configureTestingModule({
      providers: [
        // Not read here: these tests hand the group in directly.
        { provide: DataStore, useValue: {} },
        {
          provide: AnnotationGenerator,
          useValue: { canGenerate: true, generate, state: () => ({ message: 'אין מסמך' }) },
        },
      ],
    });
    return TestBed.inject(WaitingList);
  }

  it('checks each unread paper once, in order, and reports what failed', async () => {
    const seen: string[] = [];
    const list = setup(async (id) => {
      seen.push(id);
      return id === 'p2' ? null : { created: 1, discarded: 0 };
    });

    await list.checkAll(group(['p1', 'p2', 'p3']));

    expect(seen).toEqual(['p1', 'p2', 'p3']);
    expect(list.run()).toEqual(
      expect.objectContaining({ running: false, done: 3, failed: ['שירה: אין מסמך'] }),
    );
  });

  it('stops after the paper in hand when she asks', async () => {
    const seen: string[] = [];
    const list = setup(async (id) => {
      seen.push(id);
      list.stop();
      return { created: 1, discarded: 0 };
    });

    await list.checkAll(group(['p1', 'p2', 'p3']));

    expect(seen).toEqual(['p1']);
    expect(list.run()?.running).toBe(false);
  });
});
