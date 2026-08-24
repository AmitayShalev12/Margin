import { TestBed } from '@angular/core/testing';

import { DataStore } from '../../../core/data/data-store';
import { LocalRepository } from '../../../core/data/local-repository';
import { Repository } from '../../../core/data/repository';
import { seedId } from '../../../core/mock/seed-data';
import { SupabaseService } from '../../../core/supabase/supabase';
import { ReliabilityPanel } from './reliability-panel';
import { seedStore } from '../../../core/mock/seed-store';

/**
 * The panel exists to be honest about its own limits, so that is what is
 * tested: that it says nothing until asked, and that having spoken, it never
 * lets what it did not check pass for a clean bill of health.
 */

const NOA = seedId('sub-noa');

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  user = () => ({ id: 'teacher-1', email: 'ronit@school.org.il' });
  session = () => ({ access_token: 'jwt' });
  client = { auth: { getSession: async () => ({ data: { session: null } }) } };
}

async function render() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  const store = TestBed.inject(DataStore);
  // The app starts empty; these are the fixture records the test reads.
  seedStore(store);

  const fixture = TestBed.createComponent(ReliabilityPanel);
  fixture.componentRef.setInput('submissionId', NOA);
  fixture.componentRef.setInput('studentName', 'נועה');
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, store, text: () => (fixture.nativeElement as HTMLElement).textContent ?? '' };
}

function click(fixture: Awaited<ReturnType<typeof render>>['fixture'], label: string) {
  const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  );
  button!.click();
  fixture.detectChanges();
}

describe('the authenticity panel', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  /**
   * Assessing every girl who hands work in, unprompted, is a different tool
   * from the one this is meant to be.
   */
  it('checks nothing until it is asked to', async () => {
    const { fixture, store, text } = await render();

    expect(text()).toContain('לא נבדק');
    expect(store.reliabilityChecks().length).toBe(0);

    click(fixture, 'מקוריות העבודה');
    expect(text()).toContain('בדיקת מקוריות');
    // Opening the panel is still not running it.
    expect(store.reliabilityChecks().length).toBe(0);
  });

  it('lists what it never checks, before anything has been run', async () => {
    const { fixture, text } = await render();
    click(fixture, 'מקוריות העבודה');

    expect(text()).toContain('בינה מלאכותית');
    expect(text()).toContain('היסטוריית הגרסאות');
  });

  /**
   * The property the whole module is built around. A panel reporting only what
   * it found would let a teacher conclude, from an empty result, that the
   * paper had been cleared. Nothing here can support that.
   */
  it('never lets a clean result stand for a clean bill of health', async () => {
    const { fixture, store, text } = await render();
    click(fixture, 'מקוריות העבודה');
    click(fixture, 'בדיקת מקוריות');

    const shown = text();
    // Seeded students have no Drive account recorded and no synced archive, so
    // most checks cannot run at all — and the screen says which.
    expect(shown).toContain('מה לא נבדק כאן, כי חסרים נתונים');
    expect(shown).toContain('מה Margin לא בודקת בכלל');
    // The record is written, so it survives a reload.
    expect(store.reliabilityChecks().length).toBe(1);
  });

  it('raises nothing about how the work was typed', async () => {
    const { fixture, text } = await render();
    click(fixture, 'מקוריות העבודה');
    click(fixture, 'בדיקת מקוריות');

    const shown = text();
    expect(shown).not.toContain('הדבקה');
    expect(shown).not.toContain('מעט גרסאות');
  });
});
