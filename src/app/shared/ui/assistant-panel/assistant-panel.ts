import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { Assistant } from '../../../core/assistant/assistant';
import { Icon } from '../icon/icon';
import { Working } from '../working/working';

/**
 * The assistant, as a panel beside the page.
 *
 * Not modal on a wide screen: when it opens a screen or adds a student, she
 * should see that happen behind it. On a phone it takes the screen.
 */
@Component({
  selector: 'app-assistant-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Working],
  templateUrl: './assistant-panel.html',
  styleUrl: './assistant-panel.scss',
})
export class AssistantPanel {
  protected readonly assistant = inject(Assistant);

  protected readonly draft = signal('');

  /** Things she can ask, to show what kind of thing it does. */
  protected readonly suggestions = [
    'מה מחכה לי היום?',
    'להוסיף את נועה כהן לקורס הנוכחי',
    'לפתוח את העבודה האחרונה של שירה',
    'לנסח הערות לעבודה של יעל',
  ];

  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  constructor() {
    // Newest message in view, as a chat does.
    effect(() => {
      this.assistant.messages();
      this.assistant.busy();
      const element = this.log()?.nativeElement;
      if (element) queueMicrotask(() => (element.scrollTop = element.scrollHeight));
    });

    // Ready to type the moment it opens.
    effect(() => {
      if (this.assistant.isOpen()) queueMicrotask(() => this.input()?.nativeElement.focus());
    });
  }

  protected async send(text = this.draft()) {
    if (!text.trim() || this.assistant.busy()) return;
    this.draft.set('');
    // The element too, not only the signal. `[value]` writes to the DOM only
    // when the bound value changes between renders: typed and sent within one
    // tick, the binding never saw the text, so '' looks like no change and the
    // sent message stayed in the box.
    const element = this.input()?.nativeElement;
    if (element) element.value = '';
    await this.assistant.send(text);
  }

  /** Enter sends; Shift+Enter is a new line, as in every chat. */
  protected keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  protected close() {
    this.assistant.close();
  }
}
