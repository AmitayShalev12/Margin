import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Assistant } from '../../../core/assistant/assistant';
import { AssistantPanel } from './assistant-panel';

/**
 * The assistant panel's composer.
 *
 * Found in the browser, not in review: a message typed and sent within one
 * render stayed in the box after sending. `[value]` only writes to the DOM
 * when the bound value changes between renders, and a draft that went from ''
 * to text and back to '' before the next render looked like no change at all.
 */

function render() {
  const sent: string[] = [];
  const assistant = {
    isOpen: signal(true),
    busy: signal(false),
    messages: signal([]),
    available: true,
    send: async (text: string) => void sent.push(text),
    close: () => undefined,
    clear: () => undefined,
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Assistant, useValue: assistant }],
  });
  const fixture = TestBed.createComponent(AssistantPanel);
  fixture.detectChanges();
  const box = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
  return { fixture, box, sent };
}

describe('the composer', () => {
  it('empties once a message is sent, even when typed and sent in one go', async () => {
    const { fixture, box, sent } = render();

    // No render between typing and Enter — the case that left the text behind.
    box.value = 'תוסיפי את נועה';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sent).toEqual(['תוסיפי את נועה']);
    expect(box.value).toBe('');
  });

  it('keeps a new line on Shift+Enter instead of sending', async () => {
    const { fixture, box, sent } = render();

    box.value = 'שורה ראשונה';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    await fixture.whenStable();

    expect(sent).toEqual([]);
  });

  it('sends nothing for an empty message', async () => {
    const { fixture, box, sent } = render();

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    expect(sent).toEqual([]);
  });
});
