import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { SyncService } from '../../../core/drive/sync';
import { FEATURE_FLAGS } from '../../../core/features';

/**
 * One course's whole world: everything inside it belongs to it alone.
 *
 * The route names the course, so a link, a reload or a saved tab lands in the
 * right one. "current" is how the old top-level addresses arrive: it resolves to
 * the course on screen and replaces itself with the real address.
 */
@Component({
  selector: 'app-course-world',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    @if (course(); as open) {
      <div class="world">
        <header class="world-head">
          <a class="back" routerLink="/courses">כל הקורסים</a>
          <h1 class="world-title">{{ open.name }}</h1>
          <span class="world-year">{{ open.year }}</span>
        </header>
        <nav class="sections" aria-label="חלקי הקורס">
          @for (section of sections; track section.path) {
            <a
              class="section"
              [routerLink]="['/courses', open.id, section.path]"
              routerLinkActive="is-active"
              #rla="routerLinkActive"
              [attr.aria-current]="rla.isActive ? 'page' : null"
              >{{ section.label }}</a
            >
          }
        </nav>
        <router-outlet />
      </div>
    }
  `,
  styleUrl: './course-world.scss',
})
export class CourseWorld {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);
  private readonly sync = inject(SyncService);

  readonly courseId = input<string>();

  protected readonly sections = [
    { path: 'students', label: 'תלמידות' },
    { path: 'rules', label: 'כללים וחומרים' },
    { path: 'process', label: 'סיכום משימות ותהליך' },
    { path: 'grading', label: 'טופס הערכה' },
    { path: 'style', label: 'הסגנון בקורס' },
    ...(inject(FEATURE_FLAGS).mailing ? [{ path: 'messages', label: 'הודעות' }] : []),
  ];

  protected readonly course = computed(() => {
    const open = this.data.course();
    return open && open.id === this.courseId() ? open : null;
  });

  constructor() {
    effect(() => {
      const id = this.courseId();
      const courses = this.data.courses();
      untracked(() => {
        if (id === 'current') {
          const current = this.data.course();
          const rest = this.router.url.split('/').slice(3).join('/') || 'students';
          void this.router.navigateByUrl(current ? `/courses/${current.id}/${rest}` : '/courses', {
            replaceUrl: true,
          });
        } else if (courses.some((c) => c.id === id)) {
          this.data.selectCourse(id!);
          void this.sync.autoSync(id!);
        } else if (this.data.hydrated()) {
          void this.router.navigateByUrl('/courses', { replaceUrl: true });
        }
      });
    });
  }
}
