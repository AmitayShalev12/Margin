import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Assistant } from '../../core/assistant/assistant';
import { DataStore } from '../../core/data/data-store';
import { IconName } from '../../shared/ui/icon/icon';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { QuickActions } from '../../shared/ui/quick-actions/quick-actions';
import { count } from '../../core/presentation/count';

interface Workflow {
  id: string;
  title: string;
  icon: IconName;
  /** One line on what she does there — the reason to open it. */
  description: string;
  /** A live fact, when there is one worth knowing before she clicks. */
  meta: string | null;
  link: string;
  linkLabel: string;
  quick?: { label: string; run: () => void };
}

/**
 * The home screen: what she can do here, and where to start.
 *
 * A usability review found the app hard to find one's way around — it opened
 * on the student list, and everything else had to be discovered from the
 * sidebar. Home is now an overview: one card per workflow, each with its
 * entry point and the quick action that belongs to it, and above them the one
 * thing waiting on her, if anything is.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, PageHeader],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly data = inject(DataStore);
  private readonly quick = inject(QuickActions);
  private readonly assistant = inject(Assistant);

  /** Papers with comments still waiting for her decision. */
  private readonly waiting = computed(() =>
    this.data
      .submissions()
      .filter((s) => this.data.annotationsPending(s.id) > 0)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  );

  /** The paper to pick up first: the one she touched most recently. */
  protected readonly next = computed(() => {
    const first = this.waiting()[0];
    if (!first) return null;
    return {
      id: first.id,
      name: this.data.studentName(first.student_id),
      pending: this.data.annotationsPending(first.id),
    };
  });

  protected readonly waitingLine = computed(() => {
    const papers = this.waiting().length;
    if (!papers) return null;
    return count(papers, {
      one: 'בעבודה אחת יש הערות שממתינות להחלטה שלך.',
      two: 'בשתי עבודות יש הערות שממתינות להחלטה שלך.',
      many: 'ב־# עבודות יש הערות שממתינות להחלטה שלך.',
    });
  });

  protected readonly subtitle = computed(() =>
    this.data.students().length
      ? 'מה אפשר לעשות כאן, ומאיפה להתחיל.'
      : 'כדי להתחיל: מוסיפים קורס ותלמידות, ומחברים את הדרייב או מעלים עבודה.',
  );

  protected readonly workflows = computed<Workflow[]>(() => {
    const students = this.data.students().length;
    const papers = this.data.submissions().length;
    const course = this.data.course();

    return [
      {
        id: 'students',
        title: 'התלמידות שלי',
        icon: 'users',
        description: 'הרשימה, התיקייה של כל אחת, וכמה כבר נבדק אצלה.',
        meta: students
          ? count(students, { one: 'תלמידה אחת', two: 'שתי תלמידות', many: '# תלמידות' })
          : null,
        link: '/students',
        linkLabel: 'לרשימה',
        quick: { label: 'הוספת תלמידה', run: () => this.quick.openAddStudent() },
      },
      {
        id: 'submissions',
        title: 'עבודות שהוגשו',
        icon: 'docs',
        description: 'כל מה שהגיע — מהדרייב או מקובץ — ומשם לבדיקה.',
        meta: papers
          ? count(papers, { one: 'עבודה אחת', two: 'שתי עבודות', many: '# עבודות' })
          : null,
        link: '/submissions',
        linkLabel: 'לעבודות',
      },
      {
        id: 'courses',
        title: 'קורסים וחומרי רקע',
        icon: 'book',
        description: 'הכללים, החומרים והתיקיות שהבדיקה נשענת עליהם.',
        meta: course ? `${course.name} · ${course.year}` : null,
        link: '/courses',
        linkLabel: 'לקורס',
        quick: { label: 'הוספת קורס', run: () => this.quick.openAddCourse() },
      },
      {
        id: 'grading',
        title: 'טפסי הערכה',
        icon: 'clipboard',
        description: 'הטופס של הקורס, והציון של כל עבודה לפי סעיפים.',
        meta: null,
        link: '/grading-forms',
        linkLabel: 'לטפסים',
      },
      {
        id: 'style',
        title: 'הסגנון שלי',
        icon: 'quill',
        description: 'באיזה טון ההערות נכתבות, ומאילו דוגמאות שלך המערכת לומדת.',
        meta: null,
        link: '/style',
        linkLabel: 'להגדרות',
      },
    ];
  });

  protected openAssistant() {
    this.assistant.open();
  }
}
