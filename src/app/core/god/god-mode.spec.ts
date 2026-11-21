import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { SupabaseService } from '../supabase/supabase';
import { SEMINAR_STAGES } from '../tasks/seminar-map';
import { PAPER_WORDS, fakePaper, revisedPaper } from './fake-paper';
import { FAKE_DOMAIN, GOD_COURSE, GodMode, isOwner } from './god-mode';

class Account {
  isConfigured = true;
  teacherId = 'teacher-1';
  user = signal<{ email: string } | null>(null);
}

describe('the test screen', () => {
  let account: Account;
  let god: GodMode;
  let store: DataStore;

  beforeEach(() => {
    localStorage.clear();
    account = new Account();
    account.user.set({ email: 'amitay.sh123@mail.example' });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: account },
        { provide: Repository, useClass: LocalRepository },
      ],
    });
    store = TestBed.inject(DataStore);
    god = TestBed.inject(GodMode);
  });

  afterEach(() => localStorage.clear());

  it('opens for the owner and for nobody else', () => {
    expect(isOwner('amitay.sh123@anywhere.example')).toBe(true);
    expect(isOwner('Amitay.Sh123@anywhere.example')).toBe(true);
    expect(isOwner('lecturer@college.example')).toBe(false);
    expect(isOwner(null)).toBe(false);

    account.user.set({ email: 'lecturer@college.example' });
    expect(god.allowed()).toBe(false);
    expect(god.setUp()).toBe(false);
    expect(store.courses().length).toBe(0);
    expect(store.students().length).toBe(0);
  });

  it('sets up a course with sixteen stages and five invented students, once', () => {
    expect(god.setUp()).toBe(true);
    expect(god.setUp()).toBe(true);

    expect(store.courses().filter((c) => c.name === GOD_COURSE).length).toBe(1);
    expect(god.tasks().map((t) => t.title)).toEqual([...SEMINAR_STAGES]);
    expect(god.students().length).toBe(5);
    expect(god.students().every((s) => s.email!.endsWith(FAKE_DOMAIN))).toBe(true);
  });

  it('hands in papers of the length asked for, one stage after another', () => {
    god.setUp();
    const [noa, shira] = god.students();

    const short = god.submit(noa.id, 'short')!;
    const full = god.submit(shira.id, 'full')!;
    const second = god.submit(noa.id, 'medium')!;

    expect(short.word_count).toBeGreaterThanOrEqual(PAPER_WORDS.short);
    expect(short.word_count).toBeLessThan(PAPER_WORDS.short + 150);
    expect(full.word_count).toBeGreaterThanOrEqual(PAPER_WORDS.full);
    expect(store.assignmentById(short.assignment_id)?.title).toBe(SEMINAR_STAGES[0]);
    expect(store.assignmentById(second.assignment_id)?.title).toBe(SEMINAR_STAGES[1]);
    expect(short.status).toBe('new');
    expect(store.roundFor(full.id)!.document_blocks!.length).toBeGreaterThan(100);
  });

  it('gives each student her own text', () => {
    const a = fakePaper({ student: 'א', task: 'שלב', size: 'medium', seed: 2001 });
    const b = fakePaper({ student: 'ב', task: 'שלב', size: 'medium', seed: 3001 });
    expect(a.text).not.toBe(b.text);
    // And no paragraph is the same words twice, so a note has one place to land.
    const paragraphs = a.blocks.filter((x) => x.type === 'paragraph').map((x) => x.text);
    expect(new Set(paragraphs).size).toBe(paragraphs.length);
  });

  it('opens a second round for a corrected paper, only after the first was checked', () => {
    god.setUp();
    const [noa] = god.students();
    const paper = god.submit(noa.id, 'medium')!;
    const first = store.roundFor(paper.id)!;

    // Nobody has looked at it yet: there is nothing to correct.
    expect(god.resubmit(paper.id)).toBe(false);

    store.setSubmissionStatus(paper.id, 'notes_sent');
    expect(god.resubmit(paper.id)).toBe(true);

    const now = store.submission(paper.id)!;
    expect(now.status).toBe('resubmitted');
    expect(now.current_round).toBe(2);
    expect(store.round(paper.id, 1)!.document_text).toBe(first.document_text);
    expect(store.roundFor(paper.id)!.document_text).toContain('תיקנתי את העבודה לפי ההערות');
    expect(store.roundFor(paper.id)!.document_text).not.toBe(first.document_text);
  });

  it('corrects some slips and leaves others, like a real second draft', () => {
    const paper = fakePaper({ student: 'א', task: 'שלב', size: 'long', seed: 2001 });
    const revised = revisedPaper(paper.blocks);

    expect(paper.text).toContain('אין ספק שהתכנית הוכיחה את עצמה');
    expect(revised.text).not.toContain('אין ספק שהתכנית הוכיחה את עצמה');
    expect(revised.text).toContain('הסטודנטיות מרגישים');
  });

  it('removes the invented students and their papers, and nothing else', () => {
    god.setUp();
    const real = store.addStudent('תלמידה אמיתית', 'real@college.example', [god.course()!.id])!;
    god.submit(god.students()[0].id, 'short');

    expect(god.clear()).toBe(5);

    expect(god.students().length).toBe(0);
    expect(store.submissions().length).toBe(0);
    expect(store.students().map((s) => s.id)).toEqual([real.id]);
    expect(store.courses().some((c) => c.name === GOD_COURSE)).toBe(true);
  });
});
