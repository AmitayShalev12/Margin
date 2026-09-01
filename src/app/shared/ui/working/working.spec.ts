import { TestBed } from '@angular/core/testing';

import { Working } from './working';

/**
 * The indicator for a long run.
 *
 * A drafting pass reads a whole paper and writes forty comments; ninety
 * seconds is ordinary. The thing being tested is not that dots wobble — it is
 * that the component keeps saying something true as the wait gets long, because
 * a page that looks frozen gets reloaded, and reloading throws the run away.
 */

function render(label = 'מנסחת הערות', longRunNote: string | null = null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const fixture = TestBed.createComponent(Working);
  fixture.componentRef.setInput('label', label);
  fixture.componentRef.setInput('longRunNote', longRunNote);
  fixture.detectChanges();

  return {
    fixture,
    text: () => ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' '),
    tick: (seconds: number) => {
      vi.advanceTimersByTime(seconds * 1000);
      fixture.detectChanges();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('saying that something is still running', () => {
  it('names what is happening, not just that something is', () => {
    expect(render('מנקדת את העבודה').text()).toContain('מנקדת את העבודה');
  });

  it('is announced to a screen reader as it changes', () => {
    const el = (render().fixture.nativeElement as HTMLElement).querySelector('[role=status]');

    expect(el).not.toBeNull();
    expect(el!.getAttribute('aria-live')).toBe('polite');
  });

  /** The dots are decoration; the caption beside them carries the meaning. */
  it('hides the dots from the reading order', () => {
    const dots = (render().fixture.nativeElement as HTMLElement).querySelector('.dots');

    expect(dots?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('as the wait gets long', () => {
  /** A counter on a two-second wait is noise, and makes the wait a thing to watch. */
  it('says nothing about the clock at first', () => {
    const page = render();

    page.tick(5);

    expect(page.text()).not.toContain('שניות');
  });

  /**
   * The point of the whole component. Motion alone stops reassuring
   * surprisingly fast: a spinner turning for a minute reads as stuck, because
   * nothing about it says whether a minute is normal. A number that keeps
   * climbing cannot be mistaken for a hang.
   */
  it('starts counting once she might start wondering', () => {
    const page = render();

    page.tick(12);

    expect(page.text()).toContain('12 שניות');
  });

  it('keeps counting, so it can never look frozen', () => {
    const page = render();

    page.tick(12);
    page.tick(8);

    expect(page.text()).toContain('20 שניות');
  });

  /**
   * Said late on purpose. Most runs finish before forty seconds, and promising
   * a two-minute wait for something that usually takes twenty is its own lie.
   */
  it('explains a long run only once the run is actually long', () => {
    const page = render('מנסחת הערות', 'ריצה כזאת לוקחת בדרך כלל דקה עד שתיים.');

    page.tick(20);
    expect(page.text()).not.toContain('דקה עד שתיים');

    page.tick(25);
    expect(page.text()).toContain('דקה עד שתיים');
  });

  /** Nothing to promise, so nothing is promised. */
  it('counts without an explanation when none was given', () => {
    const page = render('שולחת את התגובה שלך');

    page.tick(45);

    expect(page.text()).toContain('45 שניות');
  });

  /** A timer left running after the wait ends is a leak on every run. */
  it('stops its clock when it leaves the screen', () => {
    const page = render();
    page.tick(12);

    page.fixture.destroy();

    expect(vi.getTimerCount()).toBe(0);
  });
});
