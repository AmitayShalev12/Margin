import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../core/data/data-store';
import { DocxError, readDocxText } from '../../core/import/docx-comments';
import { CourseMaterialKind, CourseRuleOrigin } from '../../core/models';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { DriveFolder } from './drive-folder/drive-folder';

interface KbItem {
  id: string;
  text: string;
  tag: string;
  note: string | null;
  muted: boolean;
}

/**
 * What a section's button actually adds.
 *
 * Carried on the section rather than switched on its id, because the button
 * used to have no handler at all and the next person to add a section should
 * have to say what pressing it does.
 */
type KbAdd =
  { of: 'rule'; origin: CourseRuleOrigin } | { of: 'material'; kind: CourseMaterialKind };

interface KbSection {
  id: string;
  title: string;
  meta: string;
  addLabel: string;
  /** Category class, so each section carries a consistent hue. */
  hue: string;
  add: KbAdd;
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
  imports: [PageHeader, DriveFolder],
  templateUrl: './courses.html',
  styleUrl: './courses.scss',
})
export class Courses {
  private readonly data = inject(DataStore);

  protected readonly course = this.data.course;
  protected readonly assignment = this.data.assignment;
  protected readonly students = computed(() => this.data.students());

  /** The page's own name before there is a course to name it after. */
  protected readonly title = computed(() => this.course()?.name ?? 'הקורס שלך');

  // -- first run --------------------------------------------------------
  //
  // The app used to open onto a fictional course with a fictional class in
  // it. Nothing is invented now, which means the first screen has to be able
  // to make the real thing — and each of these writes immediately, because a
  // record that exists only on screen is refused by every foreign key that
  // later points at it.

  protected readonly courseName = signal('');
  protected readonly courseYear = signal('');
  protected readonly assignmentTitle = signal('');
  protected readonly studentName = signal('');
  protected readonly studentEmail = signal('');
  protected readonly setupError = signal<string | null>(null);

  protected createCourse() {
    const created = this.data.createCourse(this.courseName(), this.courseYear());
    if (!created) {
      this.setupError.set('צריך שם קורס ושנה, ולהיות מחוברת לחשבון.');
      return;
    }
    this.setupError.set(null);
    this.courseName.set('');
    this.courseYear.set('');
  }

  protected createAssignment() {
    const created = this.data.createAssignment(this.assignmentTitle());
    if (!created) {
      this.setupError.set('צריך שם לעבודה.');
      return;
    }
    this.setupError.set(null);
    this.assignmentTitle.set('');
  }

  protected addStudent() {
    const created = this.data.addStudent(this.studentName(), this.studentEmail());
    if (!created) {
      this.setupError.set('צריך שם מלא של התלמידה.');
      return;
    }
    this.setupError.set(null);
    this.studentName.set('');
    this.studentEmail.set('');
  }

  protected readonly subtitle = computed(() => {
    const course = this.course();
    if (!course) return 'הקורס, העבודה והתלמידות — כאן מתחילים.';

    const assignment = this.data.assignment();
    const head = assignment ? `${assignment.title}, ${course.year}` : course.year;
    return `${head} · על סמך החומרים כאן נכתבות ההערות.`;
  });

  private readonly open = signal<Record<string, boolean>>({ rules: true });

  protected readonly sections = computed<KbSection[]>(() => {
    const rules = this.data.courseRules();
    const materials = this.data.courseMaterials();

    const myRules = rules.filter((r) => r.origin === 'teacher');
    const webRules = rules.filter((r) => r.origin === 'web');
    const syllabus = materials.filter((m) => m.kind === 'syllabus');
    const models = materials.filter((m) => m.kind === 'model_assignment');
    const corrections = materials.filter((m) => m.kind === 'example_correction');

    return [
      {
        id: 'rules',
        add: { of: 'rule', origin: 'teacher' },
        title: 'הכללים שלי',
        meta: `${myRules.filter((r) => r.active).length} כללים פעילים`,
        addLabel: 'הוספת כלל',
        hue: 'kind-language',
        items: myRules.map((r) => ({
          id: r.id,
          text: r.body,
          tag: 'שלי',
          note: null,
          muted: !r.active,
        })),
      },
      {
        id: 'syllabus',
        add: { of: 'material', kind: 'syllabus' },
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
        add: { of: 'material', kind: 'model_assignment' },
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
        add: { of: 'material', kind: 'example_correction' },
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
        add: { of: 'rule', origin: 'web' },
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

  // -- adding to the knowledge base -----------------------------------------
  //
  // Every one of these buttons used to do nothing at all: the markup had no
  // click handler, so the whole knowledge base was a display of records that
  // could only arrive from somewhere else.

  /** Which section's form is open. One at a time; they are all short. */
  protected readonly adding = signal<string | null>(null);
  protected readonly draftBody = signal('');
  protected readonly draftTitle = signal('');
  protected readonly addError = signal<string | null>(null);
  protected readonly readingFile = signal(false);

  protected isAdding(id: string): boolean {
    return this.adding() === id;
  }

  protected startAdding(id: string) {
    this.adding.set(id);
    this.draftBody.set('');
    this.draftTitle.set('');
    this.addError.set(null);
  }

  protected cancelAdding() {
    this.adding.set(null);
    this.addError.set(null);
  }

  /**
   * Fills the text from a Word file rather than asking her to paste it.
   *
   * A model paper is a `.docx` sitting on her desktop; retyping it is not a
   * thing anyone does. Only the text is kept — the file is read in the browser
   * and dropped, because the text is all the model ever reads.
   */
  protected async readFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.readingFile.set(true);
    this.addError.set(null);

    try {
      const text = await this.textOf(file);
      // Appended rather than replacing: she may have typed a rule already, and
      // silently discarding it because she then reached for a file is the kind
      // of small loss nobody reports and everybody resents.
      this.draftBody.update((current) => (current.trim() ? `${current.trim()}\n${text}` : text));

      if (!this.draftTitle().trim()) {
        this.draftTitle.set(file.name.replace(/\.(docx|txt|md)$/i, ''));
      }
    } catch (error) {
      this.addError.set(error instanceof DocxError ? error.hebrew : 'לא הצלחתי לקרוא את הקובץ.');
    } finally {
      this.readingFile.set(false);
    }
  }

  /**
   * The text of whatever she picked, or a refusal that says what to do.
   *
   * `.docx` was the only thing accepted, and the file picker hid everything
   * else — so a `.doc`, a PDF or anything exported from Drive appeared greyed
   * out and unselectable, which reads as the upload being broken rather than
   * as a format she needs to convert.
   *
   * Plain text now works too, since reading it takes one line and refusing it
   * was arbitrary. Everything else is named rather than silently ignored, with
   * the specific fix said out loud: a PDF and an old `.doc` are both one
   * "save as" away from something this can read, and that is a far better
   * thing to be told than "לא הצלחתי לקרוא את הקובץ".
   */
  private async textOf(file: File): Promise<string> {
    const name = file.name.toLowerCase();

    if (name.endsWith('.docx')) return readDocxText(await file.arrayBuffer());
    if (name.endsWith('.txt') || name.endsWith('.md')) return (await file.text()).trim();

    if (name.endsWith('.doc')) {
      throw new DocxError(
        'זה קובץ Word מהפורמט הישן (.doc). אפשר לפתוח אותו ב־Word, "שמירה בשם" ולבחור .docx.',
        'legacy .doc',
      );
    }
    if (name.endsWith('.pdf')) {
      throw new DocxError(
        'אני יודעת לקרוא קובצי Word (.docx) וטקסט, לא PDF. אפשר לפתוח את ה־PDF ב־Word ולשמור כ־.docx, או להעתיק את הטקסט לכאן.',
        'pdf',
      );
    }

    throw new DocxError(
      'אני יודעת לקרוא קובצי Word (.docx) וקובצי טקסט. אפשר גם פשוט להעתיק את הטקסט לתיבה למעלה.',
      `unsupported: ${name}`,
    );
  }

  /**
   * How many rules the text in the box would become.
   *
   * Shown before she saves, because "one rule" and "forty rules" look
   * identical in a textarea and are very different things to have added.
   */
  protected readonly draftRuleCount = computed(
    () =>
      this.draftBody()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length,
  );

  protected save(section: KbSection) {
    const written =
      section.add.of === 'rule'
        ? this.data.addCourseRules(
            sectionRuleKind(section.id),
            this.draftBody(),
            section.add.origin,
          )
        : this.data.addCourseMaterial(section.add.kind, this.draftTitle(), this.draftBody());

    if (!written) {
      this.addError.set(
        section.add.of === 'rule'
          ? 'צריך לכתוב את הכלל, וצריך קורס פתוח.'
          : 'צריך שם וגם תוכן — בלי טקסט אין מה לקרוא.',
      );
      return;
    }

    this.adding.set(null);
    this.draftBody.set('');
    this.draftTitle.set('');
    this.addError.set(null);
  }

  protected isOpen(id: string): boolean {
    return this.open()[id] ?? false;
  }

  protected toggle(id: string) {
    this.open.update((map) => ({ ...map, [id]: !map[id] }));
  }
}

/**
 * Which kind a rule written in a given section is.
 *
 * `other` for the general ones: they are conventions rather than rules about a
 * particular thing, and filing them under a specific kind would put them in
 * the prompt under a heading she never chose.
 */
function sectionRuleKind(sectionId: string): 'language' | 'other' {
  return sectionId === 'rules' ? 'language' : 'other';
}

function monthName(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', { month: 'long' }).format(new Date(iso));
}
