import { TestBed } from '@angular/core/testing';

import { DataStore } from '../../../core/data/data-store';
import { LocalRepository } from '../../../core/data/local-repository';
import { Repository } from '../../../core/data/repository';
import { SupabaseService } from '../../../core/supabase/supabase';
import { QuickActions } from '../quick-actions/quick-actions';
import { AddStudent } from './add-student';

/**
 * The "add a student" dialog, driven through its own form.
 *
 * "The form should include student details and course selection using
 * checkboxes. Allow multiple courses to be selected, create the student once,
 * and enroll her in all selected courses."
 */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function open() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  const store = TestBed.inject(DataStore);
  const methods = store.createCourse('שיטות מחקר', 'תשפ״ז')!;
  const practicum = store.createCourse('עבודה מעשית', 'תשפ״ז')!;

  const fixture = TestBed.createComponent(AddStudent);
  fixture.detectChanges();
  TestBed.inject(QuickActions).openAddStudent();
  fixture.detectChanges();

  const host = fixture.nativeElement as HTMLElement;
  const type = (index: number, value: string) => {
    const input = host.querySelectorAll<HTMLInputElement>('input.control')[index];
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const boxes = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  const press = (label: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!button) throw new Error(`no button "${label}"`);
    button.click();
    fixture.detectChanges();
  };
  const submit = () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  };

  return { store, methods, practicum, host, type, boxes, press, submit };
}

beforeEach(() => localStorage.clear());

describe('adding a student from the dialog', () => {
  it('offers every course as a checkbox, the current one already ticked', () => {
    const { boxes, host } = open();

    expect(boxes()).toHaveLength(2);
    expect(host.textContent).toContain('שיטות מחקר · תשפ״ז');
    expect(host.textContent).toContain('עבודה מעשית · תשפ״ז');
    // The course on screen is the one most recently created.
    expect(boxes().filter((b) => b.checked)).toHaveLength(1);
  });

  it('creates her once and enrolls her in every course ticked', () => {
    const { store, type, boxes, submit, host } = open();

    type(0, 'נועה כהן');
    for (const box of boxes()) if (!box.checked) box.dispatchEvent(new Event('change'));
    submit();

    expect(store.students()).toHaveLength(1);
    expect(store.coursesOf(store.students()[0].id)).toHaveLength(2);
    expect(host.querySelector('.modal-done')?.textContent).toContain('שני קורסים');
  });

  it('asks for a name rather than adding nobody', () => {
    const { store, submit, host } = open();

    submit();

    expect(store.students()).toEqual([]);
    expect(host.querySelector('.modal-error')?.textContent).toContain('שם מלא');
  });
});

describe('a student already on the roster', () => {
  /** The commonest reason: she is joining another course. */
  it('offers to enroll the existing student instead of adding another', () => {
    const { store, methods, practicum, type, boxes, submit, press } = open();
    const noa = store.addStudent('נועה כהן', undefined, [methods.id])!;

    type(0, 'נועה כהן');
    for (const box of boxes()) if (!box.checked) box.dispatchEvent(new Event('change'));
    submit();
    press('לרשום אותה לקורסים שסומנו');

    expect(store.students()).toHaveLength(1);
    expect(
      store
        .coursesOf(noa.id)
        .map((c) => c.id)
        .sort(),
    ).toEqual([methods.id, practicum.id].sort());
  });

  it('can add a different girl with the same name, on purpose', () => {
    const { store, type, submit, press } = open();
    store.addStudent('נועה כהן');

    type(0, 'נועה כהן');
    submit();
    press('זו תלמידה אחרת — להוסיף');

    expect(store.students()).toHaveLength(2);
  });

  /** An address is one person: there is no "a different girl" for it. */
  it('does not offer to add a second student with the same address', () => {
    const { store, type, submit, host } = open();
    store.addStudent('נועה כהן', 'noa@school.org.il');

    type(0, 'נ. כהן');
    type(1, 'noa@school.org.il');
    submit();

    expect(host.querySelector('.modal-clash')?.textContent).toContain('עם המייל הזה');
    expect(host.textContent).not.toContain('זו תלמידה אחרת');
    expect(store.students()).toHaveLength(1);
  });
});
