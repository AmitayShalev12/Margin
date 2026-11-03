import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AnnotationGenerator } from '../ai/annotation-generator';
import { DataStore } from '../data/data-store';
import { CommentTone, Course, Student, Submission } from '../models';
import { count } from '../presentation/count';
import { ActionName, ProposedAction } from './contract';

/** What happened when the app ran one action. Shown to her as is. */
export interface ActionOutcome {
  status: 'done' | 'failed' | 'confirm' | 'running' | 'cancelled';
  /** What the action is, in her words — "הוספת נועה כהן". */
  title: string;
  /** What actually happened, or why not. */
  detail: string;
  /** Where to see the result, when there is somewhere. */
  link?: string;
}

const SCREEN_TITLES: Record<string, string> = {
  home: 'בית',
  students: 'התלמידות שלי',
  submissions: 'עבודות שהוגשו',
  courses: 'קורסים וחומרי רקע',
  'grading-forms': 'טפסי הערכה',
  style: 'הסגנון שלי',
};

const TONE_LABELS: Record<CommentTone, string> = {
  gentle: 'עדין',
  balanced: 'מאוזן',
  direct: 'ישיר',
};

/** Actions that cannot be taken back. They wait for her confirmation. */
const NEEDS_CONFIRMATION: ReadonlySet<ActionName> = new Set(['delete_student']);

/**
 * Runs what the assistant proposed, as the signed-in teacher.
 *
 * Every action goes through the same store method her own buttons use, so the
 * database's row-level security applies to it exactly as it does to a click,
 * and anything the store refuses is refused here too. Arguments are checked
 * against her actual records first — the model is told to use only ids it was
 * given, and this is where that is enforced rather than hoped for.
 *
 * The outcome is the app's report, never the model's. It can say "מוסיפה את
 * נועה"; only this says whether she was added.
 */
@Injectable({ providedIn: 'root' })
export class AssistantActions {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);
  private readonly generator = inject(AnnotationGenerator);

  needsConfirmation(action: ProposedAction): boolean {
    return NEEDS_CONFIRMATION.has(action.name);
  }

  /** Describes an action that is waiting for her to confirm it. */
  pending(action: ProposedAction): ActionOutcome {
    const student = this.student(action.args.student_id);
    return {
      status: 'confirm',
      title: student ? `מחיקת ${student.full_name}` : 'מחיקת תלמידה',
      detail: student
        ? `${student.full_name} תצא מהרשימה, יחד עם כל העבודות וההערות שלה. אי אפשר לבטל את זה.`
        : 'לא מצאתי את התלמידה הזו ברשימה.',
    };
  }

  /** Runs one action. Destructive ones only after `confirmed` is true. */
  async run(action: ProposedAction, confirmed = false): Promise<ActionOutcome> {
    if (this.needsConfirmation(action) && !confirmed) return this.pending(action);

    try {
      return await this.perform(action);
    } catch {
      return { status: 'failed', title: 'פעולה', detail: 'משהו השתבש בביצוע. לא נעשה שינוי.' };
    }
  }

  private async perform({ name, args }: ProposedAction): Promise<ActionOutcome> {
    switch (name) {
      case 'open_screen': {
        const screen = args.screen ?? '';
        const title = SCREEN_TITLES[screen];
        if (!title) return fail('פתיחת מסך', 'אין מסך כזה באפליקציה.');
        await this.router.navigateByUrl(`/${screen}`);
        return done(`פתיחת ${title}`, `פתחתי את מסך ${title}.`);
      }

      case 'open_student_work': {
        const student = this.student(args.student_id);
        if (!student) return fail('פתיחת עבודה', 'לא מצאתי את התלמידה הזו ברשימה.');
        const paper = this.latestPaper(student.id);
        if (!paper) return fail(`העבודה של ${student.full_name}`, 'עוד לא הגיעה ממנה עבודה.');
        await this.router.navigate(['/review', paper.id]);
        return done(
          `העבודה של ${student.full_name}`,
          'פתחתי את העבודה האחרונה שלה.',
          `/review/${paper.id}`,
        );
      }

      case 'add_student': {
        const name = args.full_name?.trim() ?? '';
        if (!name) return fail('הוספת תלמידה', 'חסר שם מלא.');

        // Never a second row for the same girl: it splits her work in two on
        // every screen that resolves a name. The dialog can add a namesake
        // deliberately; the assistant does not guess.
        const clash = this.data.findStudentClash(name, args.email);
        if (clash) {
          return fail(
            `הוספת ${name}`,
            clash.on === 'email'
              ? `כבר יש ברשימה תלמידה עם המייל הזה: ${clash.student.full_name}. לא הוספתי עוד אחת.`
              : `כבר יש ברשימה תלמידה בשם ${clash.student.full_name}. לא הוספתי עוד אחת — אם זו תלמידה אחרת, אפשר להוסיף אותה מכפתור "הוספת תלמידה".`,
          );
        }

        const { known, unknown } = this.splitCourses(args.course_ids);
        const student = this.data.addStudent(
          name,
          args.email,
          known.map((c) => c.id),
        );
        if (!student) return fail(`הוספת ${name}`, 'לא הצלחתי להוסיף. ייתכן שצריך להתחבר מחדש.');

        const enrolled = this.data.coursesOf(student.id);
        return done(
          `הוספת ${student.full_name}`,
          (enrolled.length
            ? `נוספה לרשימה ונרשמה ל${courseList(enrolled)}.`
            : 'נוספה לרשימה, בלי קורס.') + skipped(unknown),
          '/students',
        );
      }

      case 'enroll_student': {
        const student = this.student(args.student_id);
        if (!student) return fail('רישום לקורס', 'לא מצאתי את התלמידה הזו ברשימה.');
        const { known, unknown } = this.splitCourses(args.course_ids);
        if (!known.length) return fail(`רישום ${student.full_name}`, 'לא מצאתי את הקורסים האלה.');

        const added = this.data.enrollStudent(
          student.id,
          known.map((c) => c.id),
        );
        return added.length
          ? done(
              `רישום ${student.full_name}`,
              `נרשמה ל${courseList(added)}.` + skipped(unknown),
              '/students',
            )
          : done(`רישום ${student.full_name}`, 'כבר הייתה רשומה לכל הקורסים האלה. לא שיניתי כלום.');
      }

      case 'unenroll_student': {
        const student = this.student(args.student_id);
        if (!student) return fail('הוצאה מקורס', 'לא מצאתי את התלמידה הזו ברשימה.');
        const { known } = this.splitCourses(args.course_ids);
        const removed = known.filter((c) => this.data.unenrollStudent(student.id, c.id));
        return removed.length
          ? done(`הוצאת ${student.full_name}`, `יצאה מ${courseList(removed)}. היא נשארת ברשימה.`)
          : fail(`הוצאת ${student.full_name}`, 'היא לא הייתה רשומה לקורסים האלה.');
      }

      case 'create_course': {
        const name = args.course_name?.trim() ?? '';
        const year = args.year?.trim() ?? '';
        if (!name || !year) return fail('יצירת קורס', 'צריך שם קורס ושנה.');
        const course = this.data.createCourse(name, year);
        if (!course)
          return fail(`יצירת ${name}`, 'לא הצלחתי ליצור את הקורס. ייתכן שצריך להתחבר מחדש.');
        return done(
          `יצירת ${course.name} · ${course.year}`,
          'הקורס נוצר, והוא עכשיו הקורס הפעיל.',
          '/courses',
        );
      }

      case 'select_course': {
        const course = this.data.courses().find((c) => c.id === args.course_id);
        if (!course) return fail('מעבר קורס', 'לא מצאתי את הקורס הזה.');
        this.data.selectCourse(course.id);
        return done(`מעבר ל${course.name} · ${course.year}`, 'זה עכשיו הקורס הפעיל.');
      }

      case 'add_course_rule': {
        const course = this.data.course();
        if (!course) return fail('הוספת כלל', 'עוד אין קורס להוסיף אליו כלל.');
        const text = args.text?.trim() ?? '';
        if (!text) return fail('הוספת כלל', 'חסר נוסח הכלל.');
        const rule = this.data.addCourseRule('other', text, 'teacher');
        if (!rule) return fail('הוספת כלל', 'לא הצלחתי להוסיף את הכלל.');
        return done('הוספת כלל', `נוסף לכללים של ${course.name}: "${text}".`, '/courses');
      }

      case 'set_comment_tone': {
        const course = this.data.course();
        if (!course) return fail('טון ההערות', 'עוד אין קורס.');
        const tone = args.tone as CommentTone;
        if (!(tone in TONE_LABELS))
          return fail('טון ההערות', 'הטון יכול להיות עדין, מאוזן או ישיר.');
        this.data.setCommentTone(tone);
        return done(
          'טון ההערות',
          `ההערות ב${course.name} ינוסחו עכשיו בטון ${TONE_LABELS[tone]}.`,
          '/style',
        );
      }

      case 'set_student_folder': {
        const student = this.student(args.student_id);
        if (!student) return fail('תיקייה בדרייב', 'לא מצאתי את התלמידה הזו ברשימה.');
        const ok = this.data.setStudentFolder(student.id, args.folder_url ?? '');
        return ok
          ? done(`התיקייה של ${student.full_name}`, 'התיקייה נשמרה.', '/students')
          : fail(`התיקייה של ${student.full_name}`, 'זה לא נראה כמו קישור לתיקייה בדרייב.');
      }

      case 'draft_comments': {
        const student = this.student(args.student_id);
        if (!student) return fail('ניסוח הערות', 'לא מצאתי את התלמידה הזו ברשימה.');
        const paper = this.latestPaper(student.id);
        if (!paper) return fail(`הערות ל${student.full_name}`, 'עוד לא הגיעה ממנה עבודה.');

        const result = await this.generator.generate(paper.id);
        if (!result) {
          return fail(
            `הערות ל${student.full_name}`,
            this.generator.state().message ?? 'ניסוח ההערות לא הצליח.',
          );
        }
        return done(
          `הערות ל${student.full_name}`,
          result.created
            ? `ניסחתי ${count(result.created, { one: 'הערה אחת', two: 'שתי הערות', many: '# הערות' })}. הן מחכות לאישור שלך.`
            : 'הריצה הסתיימה בלי הערות חדשות.',
          `/review/${paper.id}`,
        );
      }

      case 'delete_student': {
        const student = this.student(args.student_id);
        if (!student) return fail('מחיקת תלמידה', 'לא מצאתי את התלמידה הזו ברשימה.');
        this.data.deleteStudent(student.id);
        return done(`מחיקת ${student.full_name}`, 'נמחקה מהרשימה, עם העבודות שלה.');
      }
    }
  }

  private student(id: string | undefined): Student | undefined {
    return id ? this.data.students().find((s) => s.id === id) : undefined;
  }

  private latestPaper(studentId: string): Submission | undefined {
    return this.data
      .submissions()
      .filter((s) => s.student_id === studentId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  }

  /** Her courses among the ids given, and how many ids matched nothing. */
  private splitCourses(ids: string[] | undefined): { known: Course[]; unknown: number } {
    const all = new Map(this.data.courses().map((c) => [c.id, c]));
    const unique = [...new Set(ids ?? [])];
    const known = unique.map((id) => all.get(id)).filter((c): c is Course => !!c);
    return { known, unknown: unique.length - known.length };
  }
}

function done(title: string, detail: string, link?: string): ActionOutcome {
  return { status: 'done', title, detail, link };
}

function fail(title: string, detail: string): ActionOutcome {
  return { status: 'failed', title, detail };
}

function courseList(courses: Course[]): string {
  if (courses.length === 1) return `קורס ${courses[0].name}`;
  return `${count(courses.length, { one: 'קורס אחד', two: 'שני קורסים', many: '־# קורסים' })}: ${courses
    .map((c) => c.name)
    .join(', ')}`;
}

/** Said, not dropped: a course she named that does not exist here. */
function skipped(unknown: number): string {
  return unknown
    ? ` (${count(unknown, { one: 'קורס אחד לא נמצא', many: '# קורסים לא נמצאו' })}.)`
    : '';
}
