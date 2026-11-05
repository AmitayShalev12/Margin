import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { LocalRepository } from '../../../core/data/local-repository';
import { Repository } from '../../../core/data/repository';
import { SupabaseService } from '../../../core/supabase/supabase';
import { CourseSwitcher } from './course-switcher';

/** The year, first in the top bar. */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function make(build: (store: DataStore) => void = () => undefined) {
  const router = {
    url: '/courses',
    navigated: [] as string[],
    navigateByUrl: async (url: string) => void router.navigated.push(url),
  };
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
      { provide: Router, useValue: router },
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

  return { store, host, texts, pick, router };
}

describe('the year select', () => {
  it('offers the coming years, with the current course’s year selected', () => {
    const { texts, host } = make((store) => store.createCourse('סדנה', 'תשפ״ז'));

    expect(texts('.pick-year')).toEqual(expect.arrayContaining(['תשפ״ו', 'תשפ״ז', 'תשפ״ח']));
    expect(host.querySelector<HTMLSelectElement>('.pick-year')!.value).toBe('תשפ״ז');
  });

  it('shows no course from another year when this year has none', () => {
    const { store, pick } = make((s) => s.createCourse('סדנה', 'תשפ״ז'));

    pick('.pick-year', 'תשפ״ח');

    expect(store.course()).toBeNull();
    expect(localStorage.getItem('margin.year')).toBe('תשפ״ח');
  });

  it('returns to the course cards, since what was open belongs to the old year', () => {
    const { pick, router } = make((s) => s.createCourse('סדנה', 'תשפ״ז'));

    pick('.pick-year', 'תשפ״ח');

    expect(router.navigated).toEqual(['/courses']);
  });

  it('treats two spellings of a year as one', () => {
    const { store } = make((s) => s.createCourse('ישן', 'תשפז'));

    expect(store.years().filter((y) => y.replace(/״/g, '') === 'תשפז')).toHaveLength(1);
    expect(store.coursesInYear().map((c) => c.name)).toEqual(['ישן']);
  });
});
