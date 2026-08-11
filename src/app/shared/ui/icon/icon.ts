import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  'home' | 'docs' | 'book' | 'clipboard' | 'mail' | 'quill' | 'more' | 'chevron';

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
