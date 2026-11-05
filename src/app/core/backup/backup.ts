import { EMPTY_SNAPSHOT, PersistedSnapshot } from '../data/repository';
import { StyleProfile, buildStyleProfile } from '../learning/style-profile';
import { herWriting } from '../learning/voice';

/**
 * One file holding all of her work and everything learned from it.
 *
 * Built from the repository's snapshot, which holds no credentials: the Google
 * and Gemini secrets live in tables the app cannot read. Readable JSON, because
 * a backup she cannot open is a backup she has to take on trust.
 */
export const BACKUP_FORMAT = 'margin.backup';

export interface MarginBackup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exported_at: string;
  counts: Record<string, number>;
  /** What the AI learned from her, in a form that makes sense on its own. */
  learned: StyleProfile;
  data: PersistedSnapshot;
}

/** A file that cannot be restored, with what to do about it. */
export class BackupError extends Error {
  constructor(readonly hebrew: string) {
    super(hebrew);
    this.name = 'BackupError';
  }
}

type TableKey = Exclude<keyof PersistedSnapshot, 'driveFolders'>;

/**
 * Parents before children, so the foreign keys resolve when restoring.
 * `satisfies` keeps it complete: a new table must be added here to compile.
 */
export const RESTORE_ORDER = [
  'courses',
  'assignments',
  'students',
  'courseStudents',
  'courseRules',
  'courseMaterials',
  'gradingCategories',
  'submissions',
  'rounds',
  'annotations',
  'criterionScores',
  'gradingEntries',
  'studentForms',
  'studentEmails',
  'reliabilityChecks',
  'feedbackLogs',
  'styleExamples',
  'messageTemplates',
] as const satisfies readonly TableKey[];

type Row = { id: string; teacher_id?: string };

function rows(snapshot: PersistedSnapshot, table: TableKey): Row[] {
  return snapshot[table] as unknown as Row[];
}

export function buildBackup(snapshot: PersistedSnapshot, exportedAt: string): MarginBackup {
  const counts: Record<string, number> = {};
  for (const table of RESTORE_ORDER) counts[table] = (rows(snapshot, table) ?? []).length;

  return {
    format: BACKUP_FORMAT,
    version: 1,
    exported_at: exportedAt,
    counts,
    learned: buildStyleProfile({
      logs: snapshot.feedbackLogs,
      examples: snapshot.styleExamples,
      annotations: snapshot.annotations,
      ownWriting: herWriting({
        examples: [],
        annotations: snapshot.annotations,
        scores: snapshot.criterionScores,
        emails: snapshot.studentEmails,
      }),
      exportedAt,
    }),
    data: snapshot,
  };
}

export function parseBackup(text: string): MarginBackup {
  let parsed: Partial<MarginBackup> | null;
  try {
    parsed = JSON.parse(text) as Partial<MarginBackup>;
  } catch {
    throw new BackupError('הקובץ הזה לא נפתח. צריך קובץ גיבוי של Margin, שסיומת השם שלו json.');
  }

  if (parsed?.format !== BACKUP_FORMAT || !parsed.data) {
    throw new BackupError('זה לא קובץ גיבוי של Margin.');
  }
  if (parsed.version !== 1) {
    throw new BackupError('הגיבוי נוצר בגרסה אחרת של Margin, ואי אפשר לשחזר ממנו כאן.');
  }

  for (const table of RESTORE_ORDER) {
    // Backups made before templates existed are still good.
    if (table === 'messageTemplates') continue;
    if (!Array.isArray(parsed.data[table])) throw new BackupError('קובץ הגיבוי פגום או חסר.');
  }

  return parsed as MarginBackup;
}

/**
 * What the backup holds that this account has lost, and nothing else.
 *
 * Restoring only adds. A backup is older than the work on screen, so writing
 * over rows that still exist would quietly undo whatever she did since.
 *
 * Rows are written as the signed-in teacher: after moving to a new Supabase
 * project she has a new account id, and row-level security would refuse them
 * under the old one.
 */
export function missingFrom(
  backup: PersistedSnapshot,
  current: PersistedSnapshot,
  teacherId: string | null,
): PersistedSnapshot {
  const missing: PersistedSnapshot = { ...EMPTY_SNAPSHOT, driveFolders: {} };

  for (const table of RESTORE_ORDER) {
    const existing = new Set((rows(current, table) ?? []).map((r) => r.id));
    const absent = (rows(backup, table) ?? [])
      .filter((r) => !existing.has(r.id))
      .map((r) => (teacherId && 'teacher_id' in r ? { ...r, teacher_id: teacherId } : r));
    (missing as unknown as Record<string, Row[]>)[table] = absent;
  }

  for (const [owner, folder] of Object.entries(backup.driveFolders ?? {})) {
    if (!current.driveFolders[owner]) missing.driveFolders[owner] = folder;
  }

  return missing;
}

export function rowCount(snapshot: PersistedSnapshot): number {
  return RESTORE_ORDER.reduce((sum, table) => sum + (rows(snapshot, table) ?? []).length, 0);
}
