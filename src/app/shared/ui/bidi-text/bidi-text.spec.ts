import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BidiText } from './bidi-text';

/**
 * Generated comments quote the document's statistics back at the teacher, so
 * comment text needs the same bidi isolation the document already gets. Before
 * this component, comment bodies were rendered as one plain interpolation and
 * `(r = .42, p < .01)` came out with its brackets reversed.
 */
@Component({
  imports: [BidiText],
  template: `<app-bidi-text [value]="text" />`,
})
class Host {
  text = '';
}

function render(text: string): HTMLElement {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.text = text;
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('BidiText', () => {
  it('isolates a statistic quoted inside a Hebrew comment', () => {
    const el = render('בלי גודל אפקט (r = .42, p < .01) קשה לדעת אם זה משמעותי.');
    const isolated = [...el.querySelectorAll('.ltr')].map((n) => n.textContent);

    expect(isolated).toEqual(['(r = .42, p < .01)']);
  });

  it('isolates an embedded Latin term', () => {
    const el = render('מה האלפא של קרונבך לשאלון SEL?');
    expect([...el.querySelectorAll('.ltr')].map((n) => n.textContent)).toEqual(['SEL']);
  });

  it('renders the text unchanged, character for character', () => {
    const source = 'ניתוח פירסון (r = .42, p < .01) על שאלון SEL בן 24 היגדים.';
    expect(render(source).textContent).toBe(source);
  });

  it('leaves ordinary Hebrew alone', () => {
    const el = render('הנתון הזה צריך הפניה עם שנה ועמוד.');
    expect(el.querySelectorAll('.ltr').length).toBe(0);
  });

  it('handles an empty comment without emitting stray markup', () => {
    expect(render('').textContent).toBe('');
  });
});
