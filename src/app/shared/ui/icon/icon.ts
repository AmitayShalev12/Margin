import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'home'
  | 'docs'
  | 'book'
  | 'clipboard'
  | 'mail'
  | 'quill'
  | 'more'
  | 'chevron'
  | 'users'
  | 'sparkle'
  | 'plus'
  | 'close'
  | 'panel'
  | 'send'
  | 'clip'
  | 'bell';

/**
 * Small inline-SVG icon set. Line icons at a single 1.6 stroke weight, drawn
 * on a 24 grid — deliberately neutral so nothing in the set reads as
 * directional (a mirrored arrow in RTL is a classic bug we avoid by simply
 * not using directional glyphs in navigation).
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('home') {
          <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />
        }
        @case ('docs') {
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
          <path d="M10 12h5M10 16h5" />
        }
        @case ('book') {
          <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
          <path d="M17 7h2v13h-2" />
          <path d="M9 9h5" />
        }
        @case ('clipboard') {
          <path d="M9 4h6v3H9z" />
          <path d="M9 5.5H7v15h10v-15h-2" />
          <path d="M10 11h4M10 15h4" />
        }
        @case ('mail') {
          <path d="M4 6h16v12H4z" />
          <path d="m4 7 8 6 8-6" />
        }
        @case ('quill') {
          <path d="M20 4c-7 1-11 4-13 8l-2 6" />
          <path d="M9 15c4-1 7-4 8-8" />
          <path d="M5 19h6" />
        }
        @case ('more') {
          <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
        }
        @case ('chevron') {
          <path d="m9 6 6 6-6 6" />
        }
        @case ('users') {
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
          <path d="M15.5 5.2a3 3 0 0 1 0 5.6M17 14.3c2 .5 3.2 2.1 3.5 4.7" />
        }
        @case ('sparkle') {
          <path
            d="M12 3.5c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6z"
          />
          <path
            d="M18.5 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3z"
          />
        }
        @case ('bell') {
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 21a2 2 0 0 0 4 0" />
        }
        @case ('clip') {
          <path d="M19 11.5 12 18.5a4.2 4.2 0 0 1-6-6l7.5-7.5a2.8 2.8 0 0 1 4 4l-7.5 7.5a1.4 1.4 0 0 1-2-2l6.8-6.8" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('close') {
          <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
        }
        @case ('panel') {
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M14.5 4.5v15" />
        }
        @case ('send') {
          <!-- Points left: in a right-to-left interface, text and sending
               both move leftward. The one deliberately directional glyph. -->
          <path d="M19.5 12h-11" />
          <path d="m12.5 7-5 5 5 5" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(22);
}
