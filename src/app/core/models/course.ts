import { ISODateTime, OwnedByTeacher, Timestamped, UUID } from './common';

/**
 * A course the teacher runs (e.g. "עבודות גמר — כיתה יב'"). A course owns the
 * knowledge base the AI reasons from: the teacher's own rules, her syllabus,
 * model assignments and example corrections.
 */
export interface Course extends Timestamped, OwnedByTeacher {
  id: UUID;
  name: string;
  /** School year, as the teacher writes it — e.g. `תשפ"ו`. */
  year: string;
  description: string | null;
  /**
   * The course's root folder in Drive, holding one folder per year.
   *
   * Null for a course set up before the structure existed, and for one whose
   * year folder was pointed at directly — neither is a fault, and neither is
   * guessed at.
   */
  drive_course_folder_id: string | null;
  /**
   * Where submissions for *this year* arrive — the year folder inside the
   * course folder.
   *
   * The teacher shares it with her students; each student moves her own
   * document into it and keeps ownership of the file. So the work here is
   * mostly not hers, which is the whole point of the change and the reason
   * `matchStudent` can now trust the owner's address.
   */
  drive_folder_id: string | null;
  archived: boolean;
}

export type CourseRuleKind =
  | 'structure' // מבנה העבודה
  | 'sources' // מקורות וביבליוגרפיה
  | 'language' // ניסוח ולשון
  | 'formatting' // עיצוב וטכני
  | 'content' // תוכן וטיעון
  | 'other';

/**
 * Where a rule came from. `teacher` rules are hers and always win;
 * `web` rules are general academic-writing conventions pulled from the
 * internet, kept separate so she can see (and switch off) what isn't hers.
 */
export type CourseRuleOrigin = 'teacher' | 'web';

export interface CourseRule extends Timestamped {
  id: UUID;
  course_id: UUID;
  kind: CourseRuleKind;
  title: string;
  body: string;
  origin: CourseRuleOrigin;
  source_url: string | null;
  /** Inactive rules stay on record but are excluded from AI context. */
  active: boolean;
  sort_order: number;
}

export type CourseMaterialKind =
  | 'syllabus' // הסילבוס
  | 'model_assignment' // עבודה לדוגמה
  | 'example_correction' // דוגמה לתיקון שלה
  | 'reference'; // חומר רקע נוסף

/**
 * A reference document attached to a course. `content` holds the extracted
 * plain text — that is what gets fed to the model; the Drive/URL fields are
 * just provenance for the teacher.
 */
export interface CourseMaterial extends Timestamped {
  id: UUID;
  course_id: UUID;
  kind: CourseMaterialKind;
  title: string;
  notes: string | null;
  content: string | null;
  drive_file_id: string | null;
  external_url: string | null;
  active: boolean;
}

/** Enrollment: which students are in which course, for a given year. */
export interface CourseStudent {
  id: UUID;
  course_id: UUID;
  student_id: UUID;
  created_at: ISODateTime;
}
