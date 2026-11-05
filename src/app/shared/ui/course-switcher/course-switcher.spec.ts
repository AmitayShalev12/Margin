import { TestBed } from '@angular/core/testing';

import { DataStore } from '../../../core/data/data-store';
import { LocalRepository } from '../../../core/data/local-repository';
import { Repository } from '../../../core/data/repository';
import { SupabaseService } from '../../../core/supabase/supabase';
import { CourseSwitcher } from './course-switcher';

/** A course select and a year select, the one place to switch either. */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function make(build: (store: DataStore) => void = () => undefined) {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  const store = TestBed.inject(DataStore);
  build(store);

  const fixture = TestBed.createComponent(CourseSwitcher);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;

  const texts = (selector: string) =>
    [...host.querySelectorAll<HTMLOptionElement>(`${selector} option`)].map((o) => o.textContent?.trim());
  const pick = (selector: string, value: string) => {
    const select = host.querySelector<HTMLSelectElement>(selector)!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  return { store, host, texts, pick };
}

const twoYears = (store: DataStore) => {
  store.createCourse('אוריינות', 'תשפ״ו');
  store.createCourse('סמינריון', 'תשפ״ו');
  store.createCourse('סדנה', 'תשפ״ז');
};

describe('the year and course selects', () => {
  it('puts the year first', () => {
    const { host } = make(twoYears);
    const selects = host.querySelectorAll('select');
    expect(selects[0].classList).toContain('pick-year');
    expect(selects[1].classList).toContain('pick-course');
  });

  it('offers the coming years even with no course in them', () => {
    const { texts } = make(twoYears);
    expect(texts('.pick-year')).toEqual(expect.arrayContaining(['תשפ״ו', 'תשפ״ז']));
    expect(texts('.pick-year').length).toBeGreaterThanOrEqual(4);
  });

  it('lists only the courses of the selected year', () => {
    const { texts, pick } = make(twoYears);
    expect(texts('.pick-course')).toEqual(['סדנה']);

    pick('.pick-year', 'תשפ״ו');

    expect(texts('.pick-course')).toEqual(['אוריינות', 'סמינריון']);
  });

  it('switches course within the year', () => {
    const { store, pick } = make(twoYears);
    pick('.pick-year', 'תשפ״ו');
    const seminar = store.coursesInYear().find((c) => c.name === 'סמינריון')!;

    pick('.pick-course', seminar.id);

    expect(store.course()!.id).toBe(seminar.id);
  });

  it('shows no course from another year when this year has none', () => {
    const { store, host, pick } = make(twoYears);

    pick('.pick-year', 'תשפ״ח');

    expect(store.course()).toBeNull();
    expect(host.querySelector<HTMLSelectElement>('.pick-course')!.disabled).toBe(true);
  });

  it('treats two spellings of a year as one', () => {
    const { store } = make((s) => s.createCourse('ישן', 'תשפז'));

    expect(store.year()).toBe('תשפז');
    expect(store.years().filter((y) => y.replace(/״/g, '') === 'תשפז')).toHaveLength(1);
    expect(store.coursesInYear().map((c) => c.name)).toEqual(['ישן']);
  });

  it('remembers the year chosen, in this browser', () => {
    const { store } = make(twoYears);

    store.selectYear('תשפ״ח');

    expect(localStorage.getItem('margin.year')).toBe('תשפ״ח');
  });
});
