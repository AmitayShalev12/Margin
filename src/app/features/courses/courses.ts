import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { MockDataService } from '../../core/mock/mock-data';
import { PageHeader } from '../../shared/ui/page-header/page-header';

interface KbItem {
  id: string;
  text: string;
  tag: string;
  note: string | null;
  muted: boolean;
}

interface KbSection {
  id: string;
  title: string;
  meta: string;
  addLabel: string;
  /** Category class, so each section carries a consistent hue. */
  hue: string;
  items: KbItem[];
}

/**
 * The course knowledge base: everything the AI reads before it writes a
 * single comment. Reference-material management, deliberately not an admin
 * panel — one collapsed row per kind of material, opened when she wants it.
 */
@Component({
  selector: 'app-courses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader],
  templateUrl: './courses.html',
  styleUrl: './courses.scss',
})
export class Courses {
  private readonly data = inject(MockDataService);

  protected readonly course = this.data.course;

  protected readonly subtitle = `${this.data.assignment.title}, ${this.course.year} · על סמך החומרים כאן נכתבות ההערות.`;

  private readonly open = signal<Record<string, boolean>>({ rules: true });

  protected readonly sections = computed<KbSection[]>(() => {
    const rules = this.data.courseRules;
    const materials = this.data.courseMaterials;

    const myRules = rules.filter((r) => r.origin === 'teacher');
    const webRules = rules.filter((r) => r.origin === 'web');
    const syllabus = materials.filter((m) => m.kind === 'syllabus');
    const models = materials.filter((m) => m.kind === 'model_assignment');
    const corrections = materials.filter((m) => m.kind === 'example_correction');

    return [
      {
        id: 'rules',
        title: 'הכללים שלי',
        meta: `${myRules.filter((r) => r.active).length} כללים פעילים`,
        addLabel: 'הוספת כלל',
        hue: 'kind-language',
        items: myRules.map((r) => ({
          id: r.id,
          text: r.body,
          tag: 'שלי',
          note: this.data.learnedRuleNotes[r.id] ?? null,
          muted: !r.active,
        })),
      },
      {
        id: 'syllabus',
        title: 'הסילבוס',
        meta: syllabus[0] ? `עודכן ב${monthName(syllabus[0].updated_at)}` : 'טרם הועלה',
        addLabel: 'החלפת הסילבוס',
        hue: 'kind-structure',
        items: syllabus.map((m) => ({
          id: m.id,
          text: m.title,
          tag: 'מסמך',
          note: m.notes,
          muted: false,
        })),
      },
      {
        id: 'models',
        title: 'עבודות לדוגמה',
        meta: `${models.length} עבודות`,
        addLabel: 'הוספת עבודה',
        hue: 'kind-praise',
        items: models.map((m) => ({
          id: m.id,
          text: m.title,
          tag: 'עבודה',
          note: m.notes,
          muted: false,
        })),
      },
      {
        id: 'corrections',
        title: 'דוגמאות לתיקונים שלי',
        meta: `${corrections.length} דוגמאות`,
        addLabel: 'הוספת דוגמה',
        hue: 'kind-content',
        items: corrections.map((m) => ({
          id: m.id,
          text: m.title,
          tag: m.notes ?? 'דוגמה',
          note: null,
          muted: false,
        })),
      },
      {
        id: 'web',
        title: 'כללים כלליים מהאינטרנט',
        meta: `${webRules.length} כללים · אפשר לכבות`,
        addLabel: 'עיון בכללים',
        hue: 'kind-sources',
        items: webRules.map((r) => ({
          id: r.id,
          text: r.body,
          tag: r.active ? 'פעיל' : 'כבוי',
          note: null,
          muted: !r.active,
        })),
      },
    ];
  });

  protected isOpen(id: string): boolean {
    return this.open()[id] ?? false;
  }

  protected toggle(id: string) {
    this.open.update((map) => ({ ...map, [id]: !map[id] }));
  }
}

function monthName(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', { month: 'long' }).format(new Date(iso));
}
