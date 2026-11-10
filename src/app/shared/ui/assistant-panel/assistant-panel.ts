import { dualDateText } from '../../../core/dates/hebrew-date';
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
 * The assistant, as a window in the bottom-left corner.
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

  protected readonly historyOpen = signal(false);

  /** The window's size, kept in this browser. Only used from tablet width up. */
  protected readonly size = signal(readSize());

  protected startResize(event: PointerEvent) {
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...this.size() };
    const move = (e: PointerEvent) => {
      // Anchored bottom-left, so it widens to the right and grows upwards.
      this.size.set(clampSize(start.w + (e.clientX - start.x), start.h - (e.clientY - start.y)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify(this.size()));
      } catch {
        // Blocked storage: the size lasts for this visit.
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  protected newChat() {
    this.assistant.clear();
    this.historyOpen.set(false);
  }

  protected openChat(id: string) {
    this.assistant.openConversation(id);
    this.historyOpen.set(false);
  }

  protected when(iso: string): string {
    return dualDateText(iso) ?? '';
  }

  /** Files waiting to go with the next message. */
  protected readonly files = signal<File[]>([]);
  protected readonly dragging = signal(false);

  /** Things she can ask, to show what kind of thing it does. */
  protected readonly suggestions = [
    'מה מחכה לי היום?',
    'איך מוסיפים הערות למסמך של תלמידה?',
    'לסנכרן עכשיו עבודות מהדרייב',
    'לנסח הערות לעבודה האחרונה של שירה',
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
    const files = this.files();
    if ((!text.trim() && !files.length) || this.assistant.busy()) return;
    this.draft.set('');
    this.files.set([]);
    // The element too, not only the signal. `[value]` writes to the DOM only
    // when the bound value changes between renders: typed and sent within one
    // tick, the binding never saw the text, so '' looks like no change and the
    // sent message stayed in the box.
    const element = this.input()?.nativeElement;
    if (element) element.value = '';
    await this.assistant.send(text, files);
  }

  protected attach(event: Event) {
    const input = event.target as HTMLInputElement;
    this.add(input.files);
    // So picking the same file again still fires.
    input.value = '';
  }

  protected drop(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(false);
    this.add(event.dataTransfer?.files ?? null);
  }

  protected dragOver(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected removeFile(name: string) {
    this.files.update((list) => list.filter((f) => f.name !== name));
  }

  private add(list: FileList | null) {
    const incoming = [...(list ?? [])];
    const names = new Set(incoming.map((f) => f.name));
    this.files.update((current) => [...current.filter((f) => !names.has(f.name)), ...incoming]);
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

const SIZE_KEY = 'margin.assistant-size';

function clampSize(w: number, h: number): { w: number; h: number } {
  const maxW = Math.max(320, window.innerWidth - 32);
  const maxH = Math.max(360, window.innerHeight - 32);
  return {
    w: Math.round(Math.min(Math.max(w, 320), maxW)),
    h: Math.round(Math.min(Math.max(h, 360), maxH)),
  };
}

function readSize(): { w: number; h: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as { w?: number; h?: number } | null;
    if (saved && typeof saved.w === 'number' && typeof saved.h === 'number') {
      return clampSize(saved.w, saved.h);
    }
  } catch {
    // Fall through to the default.
  }
  return clampSize(420, 600);
}
