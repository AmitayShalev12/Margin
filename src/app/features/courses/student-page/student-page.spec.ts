import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AnnotationGenerator } from '../../../core/ai/annotation-generator';
import { DataStore } from '../../../core/data/data-store';
import { LocalRepository } from '../../../core/data/local-repository';
import { Repository } from '../../../core/data/repository';
import { tabKey } from '../../../core/tabs';
import { SupabaseService } from '../../../core/supabase/supabase';
import { StudentPage } from './student-page';

/** One student in one course, opened from the list. All names are invented. */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
}

function setup(generated: object | null = { created: 2, discarded: 0 }) {
  localStorage.clear();
  TestBed.resetTestingModule();
  const generator = {
    generate: async () => generated,
    state: () => ({ message: 'נגמרו הקרדיטים.' }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
      { provide: AnnotationGenerator, useValue: generator },
    ],
  });
  const store = TestBed.inject(DataStore);
  const course = store.createCourse('סמינר', 'תשפ״ז')!;
  const topic = store.addTask('נושא', null)!;
  const proposal = store.addTask('הצעה', null)!;
  store.addTask('פרק', null);
  const noa = store.addStudent('נועה כהן', 'noa@example.com', [course.id])!;
  return { store, course, topic, proposal, noa };
}

function render(studentId: string) {
  const fixture = TestBed.createComponent(StudentPage);
  fixture.componentRef.setInput('studentId', studentId);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, page: fixture.componentInstance as unknown as Record<string, any> };
}

const paper = (store: DataStore, studentId: string, assignmentId: string, name = 'a.docx') =>
  store.addUploadedSubmission({
    studentId,
    assignmentId,
    title: null,
    blocks: [{ id: 'b1', index: 0, type: 'paragraph', text: 'פסקה' }],
    text: 'פסקה',
    fileName: name,
  })!;

describe('a student page', () => {
  it('splits her papers into waiting for her and already marked', () => {
    const { store, topic, proposal, noa } = setup();
    const marked = paper(store, noa.id, topic.id, 'נושא.docx');
    paper(store, noa.id, proposal.id, 'הצעה.docx');
    store.setSubmissionStatus(marked.id, 'notes_sent');

    const { host } = render(noa.id);
    const [waiting, checked] = [...host.querySelectorAll('.papers')];

    expect(waiting.textContent).toContain('הצעה.docx');
    expect(waiting.textContent).not.toContain('נושא.docx');
    expect(checked.textContent).toContain('נושא.docx');
  });

  it('opens a paper by pressing it', () => {
    const { store, topic, noa } = setup();
    const p = paper(store, noa.id, topic.id);

    const { host } = render(noa.id);

    expect(host.querySelector('.paper-open')?.getAttribute('href')).toBe(`/review/${p.id}`);
  });

  it('lists the tasks she has not handed in', () => {
    const { store, topic, noa } = setup();
    paper(store, noa.id, topic.id);

    const { host } = render(noa.id);

    expect(host.querySelector('.not-yet')?.textContent).toContain('הצעה, פרק');
  });

  it('offers processing only on a paper with no comments yet', () => {
    const { store, topic, noa } = setup();
    paper(store, noa.id, topic.id);

    const { host } = render(noa.id);

    expect([...host.querySelectorAll('.paper button')].map((b) => b.textContent?.trim())).toEqual([
      'עיבוד העבודה',
    ]);
  });

  it('says why processing failed, and stays on the page', async () => {
    const { store, topic, noa } = setup(null);
    const p = paper(store, noa.id, topic.id);

    const { page, fixture, host } = render(noa.id);
    await page['process'](p.id);
    fixture.detectChanges();

    expect(host.querySelector('.error')?.textContent).toContain('נגמרו הקרדיטים');
  });

  it('opens a file picker only when asked, with the open tasks to choose from', () => {
    const { store, topic, noa } = setup();
    paper(store, noa.id, topic.id);

    const { host, page, fixture } = render(noa.id);
    expect(host.querySelector('input[type="file"]')).toBeNull();

    page['uploading'].set(true);
    fixture.detectChanges();

    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    expect([...host.querySelectorAll('.upload option')].map((o) => o.textContent?.trim())).toEqual([
      'הצעה',
      'פרק',
    ]);
  });

  it('keeps the folder field open when the paste is not a folder link', () => {
    const { noa } = setup();
    const { host, page, fixture } = render(noa.id);

    page['startFolder']();
    page['folderDraft'].set('התיקייה של נועה');
    page['saveFolder']();
    fixture.detectChanges();

    expect(host.querySelector('.folder-edit')).not.toBeNull();
    expect(host.querySelector('.error')?.textContent).toContain('קישור לתיקייה');
  });

  it('shows the folder once it is saved', () => {
    const { noa } = setup();
    const { host, page, fixture } = render(noa.id);

    page['startFolder']();
    page['folderDraft'].set('https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h?usp=sharing');
    page['saveFolder']();
    fixture.detectChanges();

    expect(host.querySelector('.block a.btn')?.getAttribute('href')).toBe(
      'https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h',
    );
  });

  it('opens in a tab of its own', () => {
    expect(tabKey('/courses/c1/student/s1')).toBe('student:s1');
    expect(tabKey('/courses/c1/students')).toBe('course:c1');
  });
});
